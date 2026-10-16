use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub(crate) struct SessionRevision(AtomicU64);
impl SessionRevision {
    pub(crate) fn current(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
    pub(crate) fn next(&self, expected: u64) -> Result<u64, String> {
        if self.current() != expected {
            return Err("The session changed. Review it again before resetting.".into());
        }
        if expected >= 9_007_199_254_740_991 {
            return Err("Session revision exhausted. Restart Rhema.".into());
        }
        Ok(expected + 1)
    }
    /// Called only under the native session boundary after all reset checks.
    pub(crate) fn commit(&self, next: u64) {
        self.0.store(next, Ordering::SeqCst);
    }
    pub(crate) fn require_start_revision(&self, expected: Option<u64>) -> Result<(), String> {
        if expected.is_some_and(|value| value != self.current()) {
            return Err("The operator session changed. Restart Rhema before transcribing.".into());
        }
        Ok(())
    }
    pub(crate) fn start_reserved(
        &self,
        sessions: &crate::transcription_session::SessionController,
        start_revision: u64,
        expected_session_revision: Option<u64>,
        initialize: impl FnOnce() -> Result<(), String>,
    ) -> Result<crate::transcription_session::SessionToken, String> {
        sessions.start_reserved(start_revision, || {
            self.require_start_revision(expected_session_revision)?;
            initialize()
        })
    }
    pub(crate) fn with_current<T>(
        &self,
        sessions: &crate::transcription_session::SessionController,
        expected: u64,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        sessions.with_boundary(|| {
            if self.current() != expected {
                return Err("Detection belongs to an earlier session".into());
            }
            action()
        })
    }
}

#[derive(Clone, Serialize)]
struct SessionPacket<S> {
    revision: u64,
    payload: S,
}

pub(crate) trait SessionEmitter {
    fn emit_session<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()>;
}
impl SessionEmitter for AppHandle {
    fn emit_session<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()> {
        let packet = SessionPacket {
            revision: self.state::<SessionRevision>().current(),
            payload: &payload,
        };
        // The main controller consumes only this tagged route. Keep existing
        // raw routes for compatible consumers such as the audio-test meter.
        self.emit(&format!("session:{event}"), packet)?;
        let _ = self.emit(event, payload);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_fresh_start_counter_cannot_admit_a_stale_webview_session_owner() {
        use std::sync::{atomic::AtomicBool, Arc};
        let revision = SessionRevision::default();
        let sessions = crate::transcription_session::SessionController::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        sessions
            .with_stopped(|| {
                revision.commit(revision.next(0)?);
                Ok(())
            })
            .unwrap();
        let fresh_counter = sessions.begin_start().unwrap();
        let result = revision.start_reserved(
            &sessions,
            fresh_counter,
            Some(0),
            || -> Result<(), String> {
                panic!("stale session reset detection context or started capture")
            },
        );
        assert!(result.err().unwrap().contains("Restart Rhema"));
        assert_eq!(sessions.begin_start().unwrap(), fresh_counter);
        let current = revision
            .start_reserved(&sessions, fresh_counter, Some(1), || Ok(()))
            .unwrap();
        assert!(current.is_active());
        sessions.stop().unwrap();
        let legacy_counter = sessions.begin_start().unwrap();
        assert!(revision
            .start_reserved(&sessions, legacy_counter, None, || Ok(()))
            .is_ok());
    }
    #[test]
    fn manual_work_finishes_before_reset_and_a_queued_old_revision_cannot_mutate() {
        use std::{
            sync::{mpsc, Arc},
            time::Duration,
        };
        let revision = Arc::new(SessionRevision::default());
        let sessions = Arc::new(crate::transcription_session::SessionController::new(
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
            Arc::new(std::sync::atomic::AtomicBool::new(false)),
        ));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker_revision = revision.clone();
        let worker_sessions = sessions.clone();
        let worker = std::thread::spawn(move || {
            worker_revision.with_current(&worker_sessions, 0, || {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(42)
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (done_tx, done_rx) = mpsc::channel();
        let reset_revision = revision.clone();
        let reset_sessions = sessions.clone();
        let reset = std::thread::spawn(move || {
            reset_sessions.with_stopped(|| {
                let next = reset_revision.next(0)?;
                reset_revision.commit(next);
                done_tx.send(()).unwrap();
                Ok(())
            })
        });
        assert!(done_rx.recv_timeout(Duration::from_millis(25)).is_err());
        release_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap().unwrap(), 42);
        reset.join().unwrap().unwrap();
        assert_eq!(revision.current(), 1);
        assert!(revision
            .with_current(&sessions, 0, || -> Result<(), String> {
                panic!("old manual request crossed reset")
            })
            .is_err());
        assert_eq!(revision.with_current(&sessions, 1, || Ok(7)).unwrap(), 7);
    }
    #[test]
    fn revision_is_checked_before_mutation_and_envelope_retains_exact_payload() {
        let revision = SessionRevision::default();
        assert_eq!(revision.current(), 0);
        assert_eq!(revision.next(0).unwrap(), 1);
        assert!(revision.next(1).is_err());
        revision.commit(1);
        assert!(revision.next(0).is_err());
        assert_eq!(revision.next(1).unwrap(), 2);
        let packet = SessionPacket {
            revision: 1,
            payload: vec!["Unicode Ọ̀rọ̀", "two"],
        };
        let serialized = serde_json::to_value(packet).unwrap();
        assert_eq!(serialized["revision"], 1);
        assert_eq!(serialized["payload"][0], "Unicode Ọ̀rọ̀");
        revision.commit(9_007_199_254_740_991);
        assert!(revision.next(9_007_199_254_740_991).is_err());
    }
}
