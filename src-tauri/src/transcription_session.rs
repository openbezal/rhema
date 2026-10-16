//! Serialized boundaries for native transcription work and per-run cancellation.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, MutexGuard,
};
use tokio::sync::Notify;

/// A run can be cancelled once. A later run receives a distinct token.
#[derive(Clone)]
pub(crate) struct SessionToken {
    active: Arc<AtomicBool>,
    cancelled: Arc<Notify>,
}
impl SessionToken {
    fn new() -> Self {
        Self {
            active: Arc::new(AtomicBool::new(true)),
            cancelled: Arc::new(Notify::new()),
        }
    }
    pub(crate) fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }
    fn cancel(&self) {
        self.active.store(false, Ordering::SeqCst);
        // One provider watcher per run; notify_one also retains an early cancellation.
        self.cancelled.notify_one();
    }
    pub(crate) async fn cancelled(&self) {
        if self.is_active() {
            self.cancelled.notified().await;
        }
    }
}

/// Lock order: session boundary → individual detection/AppState mutexes.
/// Never acquire the session boundary while retaining `AppState`'s mutex.
/// Audio capture is independently serialized and is never awaited under the boundary.
pub(crate) struct SessionController {
    current: Mutex<Option<SessionToken>>,
    start_revision: AtomicU64,
    capture: Mutex<()>,
    stt_active: Arc<AtomicBool>,
    audio_active: Arc<AtomicBool>,
}
impl SessionController {
    pub(crate) fn new(stt_active: Arc<AtomicBool>, audio_active: Arc<AtomicBool>) -> Self {
        Self {
            current: Mutex::new(None),
            start_revision: AtomicU64::new(0),
            capture: Mutex::new(()),
            stt_active,
            audio_active,
        }
    }
    pub(crate) fn start(
        &self,
        initialize: impl FnOnce() -> Result<(), String>,
    ) -> Result<SessionToken, String> {
        let mut current = self.current.lock().map_err(|e| e.to_string())?;
        if current.as_ref().is_some_and(SessionToken::is_active) {
            return Err("Transcription is already running".into());
        }
        initialize()?;
        let token = SessionToken::new();
        *current = Some(token.clone());
        self.set_status(true);
        Ok(token)
    }
    /// Capture before provider preparation, including any async audio preemption.
    pub(crate) fn begin_start(&self) -> Result<u64, String> {
        let current = self.current.lock().map_err(|error| error.to_string())?;
        if current.as_ref().is_some_and(SessionToken::is_active) {
            return Err("Transcription is already running".into());
        }
        Ok(self.start_revision.load(Ordering::SeqCst))
    }
    pub(crate) fn start_reserved(
        &self,
        revision: u64,
        initialize: impl FnOnce() -> Result<(), String>,
    ) -> Result<SessionToken, String> {
        self.start(|| {
            if self.start_revision.load(Ordering::SeqCst) != revision {
                return Err("Transcription start was cancelled".into());
            }
            initialize()
        })
    }
    /// Serialize a stopped-state action against start and final run work.
    pub(crate) fn with_stopped<T>(
        &self,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let current = self.current.lock().map_err(|error| error.to_string())?;
        if current.as_ref().is_some_and(SessionToken::is_active) {
            return Err("Stop transcription before applying preferences".into());
        }
        self.start_revision.fetch_add(1, Ordering::SeqCst);
        let result = action();
        drop(current);
        result
    }
    pub(crate) fn with_current<R>(
        &self,
        token: &SessionToken,
        action: impl FnOnce() -> R,
    ) -> Option<R> {
        let current = self.current.lock().ok()?;
        if token.is_active()
            && current
                .as_ref()
                .is_some_and(|run| Arc::ptr_eq(&run.active, &token.active))
        {
            Some(action())
        } else {
            None
        }
    }
    pub(crate) fn stop(&self) -> Result<(), String> {
        let mut current = self.current.lock().map_err(|e| e.to_string())?;
        // Even an early stop with no active token cancels provider preparation.
        self.start_revision.fetch_add(1, Ordering::SeqCst);
        let token = current
            .take()
            .filter(SessionToken::is_active)
            .ok_or("Transcription is not running")?;
        token.cancel();
        self.set_status(false);
        Ok(())
    }
    pub(crate) fn finish(&self, token: &SessionToken) {
        let Ok(mut current) = self.current.lock() else {
            return;
        };
        if current
            .as_ref()
            .is_some_and(|run| Arc::ptr_eq(&run.active, &token.active))
        {
            token.cancel();
            *current = None;
            self.set_status(false);
        }
    }
    fn set_status(&self, active: bool) {
        self.stt_active.store(active, Ordering::SeqCst);
        self.audio_active.store(active, Ordering::SeqCst);
    }
    pub(crate) fn capture_guard(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.capture.lock().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    };
    use std::time::Duration;

    fn sessions() -> SessionController {
        SessionController::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        )
    }

    #[test]
    fn stopped_actions_refuse_active_transcription_and_propagate_errors() {
        let sessions = sessions();
        sessions.start(|| Ok(())).unwrap();
        assert!(sessions
            .with_stopped(|| -> Result<(), String> { panic!("must not apply while running") })
            .is_err());
        sessions.stop().unwrap();
        assert_eq!(
            sessions.with_stopped(|| Err::<(), _>("disk full".to_string())),
            Err("disk full".to_string())
        );
        assert!(!sessions.stt_active.load(Ordering::SeqCst));
        assert_eq!(sessions.with_stopped(|| Ok(42)), Ok(42));
    }

    #[test]
    fn stopped_action_serializes_a_concurrent_start() {
        let sessions = Arc::new(sessions());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let maintenance_sessions = sessions.clone();
        let maintenance = std::thread::spawn(move || {
            maintenance_sessions.with_stopped(|| {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                Ok(())
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let start_sessions = sessions.clone();
        let starter = std::thread::spawn(move || {
            start_sessions.start(|| {
                started_tx.send(()).unwrap();
                Ok(())
            })
        });
        assert!(started_rx.recv_timeout(Duration::from_millis(25)).is_err());
        release_tx.send(()).unwrap();
        maintenance.join().unwrap().unwrap();
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(starter.join().unwrap().unwrap().is_active());
    }

    #[test]
    fn stopping_before_provider_setup_finishes_cancels_the_reserved_start() {
        let sessions = sessions();
        let attempt = sessions.begin_start().unwrap();
        assert!(sessions.stop().is_err());
        assert!(sessions
            .start_reserved(attempt, || panic!(
                "obsolete provider setup restarted transcription"
            ))
            .is_err());
        assert!(!sessions.stt_active.load(Ordering::SeqCst));
        let current = sessions.begin_start().unwrap();
        assert!(sessions
            .start_reserved(current, || Ok(()))
            .unwrap()
            .is_active());
    }

    #[test]
    fn stopped_maintenance_invalidates_already_reserved_provider_setup() {
        let sessions = sessions();
        let attempt = sessions.begin_start().unwrap();
        sessions.with_stopped(|| Ok(())).unwrap();
        assert!(sessions
            .start_reserved(attempt, || panic!("old parameters survived maintenance"))
            .is_err());
        let current = sessions.begin_start().unwrap();
        assert!(sessions.start_reserved(current, || Ok(())).is_ok());
    }
    #[test]
    fn stopped_workers_cannot_revive_when_a_new_run_starts() {
        let sessions = sessions();
        let old = sessions.start(|| Ok(())).unwrap();
        sessions.stop().unwrap();
        let new = sessions.start(|| Ok(())).unwrap();
        assert!(!old.is_active());
        assert!(new.is_active());
        let mut emitted = Vec::new();
        assert!(sessions
            .with_current(&old, || emitted.push("stale"))
            .is_none());
        assert!(sessions
            .with_current(&new, || emitted.push("new"))
            .is_some());
        assert_eq!(emitted, ["new"]);
    }
    #[test]
    fn obsolete_provider_completion_cannot_stop_its_replacement() {
        let sessions = sessions();
        let old = sessions.start(|| Ok(())).unwrap();
        sessions.stop().unwrap();
        let new = sessions.start(|| Ok(())).unwrap();
        sessions.finish(&old);
        assert!(new.is_active());
        assert!(sessions.with_current(&new, || ()).is_some());
    }
    #[test]
    fn concurrent_start_is_rejected_without_resetting_current_context() {
        let sessions = sessions();
        let original = sessions.start(|| Ok(())).unwrap();
        assert!(sessions
            .start(|| panic!("must not reset an active session"))
            .is_err());
        assert!(original.is_active());
    }
    #[test]
    fn failed_initialization_never_activates_or_publishes_a_session() {
        let sessions = sessions();
        assert!(sessions.start(|| Err("reset failed".into())).is_err());
        assert!(sessions.stop().is_err());
        assert!(sessions.start(|| Ok(())).is_ok());
    }
    #[test]
    fn stop_waits_for_inflight_work_then_rejects_queued_work() {
        let sessions = Arc::new(sessions());
        let old = sessions.start(|| Ok(())).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let worker_sessions = sessions.clone();
        let worker_token = old.clone();
        let worker = std::thread::spawn(move || {
            worker_sessions.with_current(&worker_token, || {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            })
        });
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (stopped_tx, stopped_rx) = mpsc::channel();
        let stopper_sessions = sessions.clone();
        let stopper = std::thread::spawn(move || {
            stopper_sessions.stop().unwrap();
            stopped_tx.send(()).unwrap();
        });
        assert!(stopped_rx.recv_timeout(Duration::from_millis(25)).is_err());
        release_tx.send(()).unwrap();
        stopped_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(worker.join().unwrap().is_some());
        stopper.join().unwrap();
        sessions.start(|| Ok(())).unwrap();
        assert!(sessions
            .with_current(&old, || panic!("queued obsolete work ran"))
            .is_none());
    }
    #[tokio::test]
    async fn cancellation_wakes_the_provider_and_survives_early_stop() {
        let sessions = sessions();
        let token = sessions.start(|| Ok(())).unwrap();
        sessions.stop().unwrap();
        tokio::time::timeout(Duration::from_secs(1), token.cancelled())
            .await
            .unwrap();
        let token = sessions.start(|| Ok(())).unwrap();
        let waiting = token.clone();
        let waiter = tokio::spawn(async move {
            waiting.cancelled().await;
        });
        tokio::task::yield_now().await;
        sessions.stop().unwrap();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
    }
    #[test]
    fn status_flags_only_follow_the_current_run() {
        let stt = Arc::new(AtomicBool::new(false));
        let audio = Arc::new(AtomicBool::new(false));
        let sessions = SessionController::new(stt.clone(), audio.clone());
        let old = sessions.start(|| Ok(())).unwrap();
        assert!(stt.load(Ordering::SeqCst) && audio.load(Ordering::SeqCst));
        sessions.finish(&old);
        assert!(!stt.load(Ordering::SeqCst) && !audio.load(Ordering::SeqCst));
        let new = sessions.start(|| Ok(())).unwrap();
        sessions.finish(&old);
        assert!(stt.load(Ordering::SeqCst) && audio.load(Ordering::SeqCst));
        sessions.stop().unwrap();
        assert!(!new.is_active());
    }
    #[test]
    fn capture_ownership_waits_for_the_old_run_to_release_the_device() {
        let sessions = Arc::new(sessions());
        let old = sessions.start(|| Ok(())).unwrap();
        let capture = sessions.capture_guard().unwrap();
        sessions.stop().unwrap();
        let current = sessions.start(|| Ok(())).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel();
        let next_sessions = sessions.clone();
        let worker = std::thread::spawn(move || {
            let _next_capture = next_sessions.capture_guard().unwrap();
            assert!(current.is_active());
            entered_tx.send(()).unwrap();
        });
        assert!(!old.is_active());
        assert!(entered_rx.recv_timeout(Duration::from_millis(25)).is_err());
        drop(capture);
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        worker.join().unwrap();
    }
}
