use crate::{session_events::SessionRevision, state::AppState};
use rhema_detection::{DetectionMerger, DetectionPipeline, DirectDetector, ReadingMode};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::Manager;

struct ResetContext<'a> {
    direct: &'a Mutex<DirectDetector>,
    reading: &'a Mutex<ReadingMode>,
    merger: &'a Mutex<DetectionMerger>,
    pipeline: &'a Mutex<DetectionPipeline>,
}
/// Session boundary and `AppState` lock must already be held. Acquire every
/// fallible lock before clearing anything; all following mutation is infallible.
fn reset_idle_context(
    expected: u64,
    revision: &SessionRevision,
    audio: &AtomicBool,
    context: &ResetContext<'_>,
) -> Result<u64, String> {
    if audio.load(Ordering::SeqCst) {
        return Err("Stop the audio test before starting a new session.".into());
    }
    let next = revision.next(expected)?;
    let mut direct = context.direct.lock().map_err(|e| e.to_string())?;
    let mut reading = context.reading.lock().map_err(|e| e.to_string())?;
    let mut merger = context.merger.lock().map_err(|e| e.to_string())?;
    let mut pipeline = context.pipeline.lock().map_err(|e| e.to_string())?;
    *direct = DirectDetector::new();
    *reading = ReadingMode::new();
    merger.reset_session();
    pipeline.reset_session();
    revision.commit(next);
    Ok(next)
}

fn require_operator_window(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Session maintenance is available only in the main window".into())
    }
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command extractors require pass-by-value"
)]
pub fn read_operator_session_revision(
    window: tauri::WebviewWindow,
    revision: tauri::State<'_, SessionRevision>,
) -> Result<u64, String> {
    require_operator_window(window.label())?;
    Ok(revision.current())
}

#[derive(serde::Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum SessionResetOutcome {
    Reset { revision: u64 },
    Rejected { message: String, revision: u64 },
}

#[tauri::command]
pub async fn reset_operator_session(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    expected_revision: u64,
) -> Result<SessionResetOutcome, String> {
    require_operator_window(window.label())?;
    let sessions = app
        .state::<Mutex<AppState>>()
        .lock()
        .map_err(|e| e.to_string())?
        .transcription_sessions
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = sessions.with_stopped(|| {
            let state = app.state::<Mutex<AppState>>();
            let state = state.lock().map_err(|e| e.to_string())?;
            reset_idle_context(
                expected_revision,
                &app.state::<SessionRevision>(),
                &state.audio_test_active,
                &ResetContext {
                    direct: &app.state::<Mutex<DirectDetector>>(),
                    reading: &app.state::<Mutex<ReadingMode>>(),
                    merger: &app.state::<Mutex<DetectionMerger>>(),
                    pipeline: &app.state::<Mutex<DetectionPipeline>>(),
                },
            )
        });
        match result {
            Ok(revision) => SessionResetOutcome::Reset { revision },
            Err(message) => SessionResetOutcome::Rejected {
                message,
                revision: app.state::<SessionRevision>().current(),
            },
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_detection::{DetectionMerger, DetectionPipeline, DirectDetector, ReadingMode};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    #[test]
    fn a_known_refusal_reports_its_current_session_revision() {
        let outcome = SessionResetOutcome::Rejected {
            message: "Stop the audio test".into(),
            revision: 7,
        };
        let value = serde_json::to_value(outcome).unwrap();
        assert_eq!(value["status"], "rejected");
        assert_eq!(value["revision"], 7);
    }

    #[test]
    fn reset_is_stopped_atomic_and_preserves_configuration() {
        let direct = Mutex::new(DirectDetector::new());
        let reading = Mutex::new(ReadingMode::new());
        let merger = Mutex::new(DetectionMerger::new());
        let pipeline = Mutex::new(DetectionPipeline::new());
        let context = ResetContext {
            direct: &direct,
            reading: &reading,
            merger: &merger,
            pipeline: &pipeline,
        };
        let revision = crate::session_events::SessionRevision::default();
        let audio = AtomicBool::new(false);
        let sessions = crate::transcription_session::SessionController::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        );
        let found = direct.lock().unwrap().detect("John 3:16");
        {
            let mut merger = merger.lock().unwrap();
            merger.set_cooldown_ms(60_000);
            merger.set_confidence_threshold(0.94);
            assert!(merger.merge(found, vec![])[0].auto_queued);
        }
        reading.lock().unwrap().start(
            43,
            "John",
            3,
            16,
            vec![(16, "For God so loved the world".into())],
        );
        pipeline.lock().unwrap().process_direct("John 3:16");
        let reset = |expected| {
            sessions.with_stopped(|| reset_idle_context(expected, &revision, &audio, &context))
        };
        sessions.start(|| Ok(())).unwrap();
        assert!(reset(0).is_err());
        assert!(reading.lock().unwrap().has_verses());
        sessions.stop().unwrap();
        audio.store(true, Ordering::SeqCst);
        assert!(reset(0).is_err());
        assert_eq!(revision.current(), 0);
        audio.store(false, Ordering::SeqCst);
        assert!(reset(4).is_err());
        assert!(reading.lock().unwrap().has_verses());
        assert_eq!(reset(0).unwrap(), 1);
        assert!(!reading.lock().unwrap().has_verses());
        assert!(direct.lock().unwrap().detect("verse 17").is_empty());
        assert!(pipeline
            .lock()
            .unwrap()
            .process_direct("verse 17")
            .is_empty());
        let found = direct.lock().unwrap().detect("John 3:16");
        assert!(merger.lock().unwrap().merge(found, vec![])[0].auto_queued);
        let low = direct.lock().unwrap().detect("3:17");
        assert!(merger.lock().unwrap().merge(low, vec![]).is_empty());
        assert!(reset(0).is_err());
        assert_eq!(reset(1).unwrap(), 2);
    }
    #[test]
    fn a_poisoned_last_lock_cannot_partially_reset_earlier_components() {
        let direct = Mutex::new(DirectDetector::new());
        direct.lock().unwrap().detect("John 3:16");
        let reading = Mutex::new(ReadingMode::new());
        reading
            .lock()
            .unwrap()
            .start(43, "John", 3, 16, vec![(16, "text".into())]);
        let merger = Mutex::new(DetectionMerger::new());
        let pipeline = Mutex::new(DetectionPipeline::new());
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = pipeline.lock().unwrap();
            panic!("synthetic poison");
        }));
        let revision = crate::session_events::SessionRevision::default();
        let result = reset_idle_context(
            0,
            &revision,
            &AtomicBool::new(false),
            &ResetContext {
                direct: &direct,
                reading: &reading,
                merger: &merger,
                pipeline: &pipeline,
            },
        );
        assert!(result.is_err());
        assert_eq!(revision.current(), 0);
        assert!(reading.lock().unwrap().has_verses());
        assert!(!direct.lock().unwrap().detect("verse 17").is_empty());
    }
    #[test]
    fn reset_is_only_available_from_the_actual_operator_window() {
        assert!(require_operator_window("main").is_ok());
        for label in ["broadcast-main", "MAIN", "main-copy", ""] {
            assert!(require_operator_window(label).is_err());
        }
    }
}
