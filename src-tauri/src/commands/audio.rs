#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command extractors require pass-by-value"
)]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::session_events::{SessionEmitter, SessionRevision};
use crate::transcription_session::SessionController;
use tauri::{AppHandle, Manager, State};

use crate::events::{
    AudioLevelPayload, AudioTestStoppedPayload, EVENT_AUDIO_LEVEL, EVENT_AUDIO_TEST_STOPPED,
};
use crate::state::AppState;
use rhema_audio::{AudioConfig, AudioFrame, DeviceInfo};

/// Hard ceiling on a single test run — the thread self-stops afterwards so a
/// forgotten test can never leave the microphone open.
const TEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Capture the logical session while claiming the test under `AppState`. Emission
/// takes only the session boundary, after `AppState` has been released.
struct AudioTestSession {
    sessions: Arc<SessionController>,
    revision: u64,
}

fn claim_test(
    state: &Mutex<AppState>,
    app: &AppHandle,
) -> Result<(Arc<AtomicBool>, AudioTestSession), String> {
    let app_state = state.lock().map_err(|error| error.to_string())?;
    check_test_start(
        app_state.stt_active.load(Ordering::SeqCst),
        app_state.audio_test_active.load(Ordering::SeqCst),
    )?;
    app_state.audio_test_active.store(true, Ordering::SeqCst);
    Ok((
        app_state.audio_test_active.clone(),
        AudioTestSession::new(
            app_state.transcription_sessions.clone(),
            &app.state::<SessionRevision>(),
        ),
    ))
}
impl AudioTestSession {
    fn new(sessions: Arc<SessionController>, clock: &SessionRevision) -> Self {
        Self {
            sessions,
            revision: clock.current(),
        }
    }
    fn publish<T>(
        &self,
        clock: &SessionRevision,
        action: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        clock.with_current(&self.sessions, self.revision, action)
    }
    fn emit<S: serde::Serialize + Clone>(&self, app: &AppHandle, event: &str, payload: S) {
        let _ = self.publish(&app.state::<SessionRevision>(), || {
            app.emit_session(event, payload)
                .map_err(|error| error.to_string())
        });
    }
}

/// List all available audio input devices.
#[tauri::command]
pub fn get_audio_devices(_state: State<'_, Mutex<AppState>>) -> Result<Vec<DeviceInfo>, String> {
    rhema_audio::device::enumerate_devices().map_err(|e| e.to_string())
}

/// Guard for `start_audio_test`: capture and STT can't share the device.
fn check_test_start(stt_active: bool, test_active: bool) -> Result<(), &'static str> {
    if stt_active {
        return Err("Transcription is running — stop it before testing");
    }
    if test_active {
        return Err("Audio test is already running");
    }
    Ok(())
}

/// Start a short-lived capture from the selected device, emitting `audio_level`
/// events so the user can verify the source picks up sound — no STT involved.
///
/// cpal's `Stream` is !Send, so capture runs on a dedicated thread (same
/// rationale as the fanout thread in `stt.rs`). Unlike transcription there is
/// no rebuild watchdog: a lost device simply ends the test with an
/// `audio_test_stopped { reason: "device_lost" }` event.
#[tauri::command]
pub fn start_audio_test(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    device_id: Option<String>,
    gain: Option<f32>,
) -> Result<(), String> {
    let (test_active, test_session) = claim_test(&state, &app)?;

    // One-shot handshake: the thread reports whether `capture::start`
    // succeeded so device errors (e.g. DeviceNotFound) surface synchronously —
    // "does this device work?" is exactly what the caller is asking.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    let thread_active = test_active.clone();
    let spawn_result = std::thread::Builder::new()
        .name("audio-test".into())
        .spawn(move || {
            let config = AudioConfig {
                device_id,
                sample_rate: 16_000,
                gain: gain.unwrap_or(1.0).clamp(0.0, 2.0),
            };

            let device_lost = Arc::new(AtomicBool::new(false));
            let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);

            let capture = match rhema_audio::capture::start(config, audio_tx, device_lost.clone()) {
                Ok(c) => {
                    let _ = ready_tx.send(Ok(()));
                    c
                }
                Err(e) => {
                    thread_active.store(false, Ordering::SeqCst);
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };

            log::info!("[AUDIO TEST] Capture started");

            let deadline = Instant::now() + TEST_TIMEOUT;
            let mut last_frame_at = Instant::now();
            let mut frame_count: u64 = 0;

            let reason = loop {
                if !thread_active.load(Ordering::SeqCst) {
                    break "stopped";
                }
                if Instant::now() >= deadline {
                    break "timeout";
                }
                if device_lost.load(Ordering::SeqCst)
                    || last_frame_at.elapsed() > Duration::from_secs(2)
                {
                    break "device_lost";
                }

                match audio_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(frame) => {
                        last_frame_at = Instant::now();
                        frame_count += 1;
                        // ~15 Hz at 16 kHz with ~1024-sample frames (as in stt.rs).
                        if frame_count % 4 == 0 {
                            let level = rhema_audio::meter::compute_level(&frame.samples);
                            test_session.emit(
                                &app,
                                EVENT_AUDIO_LEVEL,
                                AudioLevelPayload {
                                    rms: level.rms,
                                    peak: level.peak,
                                },
                            );
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break "device_lost",
                }
            };

            capture.stop();
            thread_active.store(false, Ordering::SeqCst);
            test_session.emit(
                &app,
                EVENT_AUDIO_LEVEL,
                AudioLevelPayload {
                    rms: 0.0,
                    peak: 0.0,
                },
            );
            test_session.emit(
                &app,
                EVENT_AUDIO_TEST_STOPPED,
                AudioTestStoppedPayload {
                    reason: reason.to_string(),
                },
            );
            log::info!("[AUDIO TEST] Capture stopped ({reason})");
        });

    if let Err(e) = spawn_result {
        test_active.store(false, Ordering::SeqCst);
        return Err(format!("Failed to spawn audio test thread: {e}"));
    }

    // Wait for the capture to actually open so device errors reach the caller.
    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            // Thread is wedged opening the device; tell it to stop and bail.
            test_active.store(false, Ordering::SeqCst);
            Err("Timed out opening the audio device".into())
        }
    }
}

/// Stop a running audio test. Idempotent — succeeds even if no test is active,
/// so unmount cleanups and races are harmless.
#[tauri::command]
pub fn stop_audio_test(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.audio_test_active.store(false, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::check_test_start;

    #[test]
    fn stopped_test_events_keep_their_origin_and_cannot_enter_a_reset_session() {
        use std::sync::{atomic::AtomicBool, Arc};
        let revision = crate::session_events::SessionRevision::default();
        let sessions = Arc::new(crate::transcription_session::SessionController::new(
            Arc::new(AtomicBool::new(false)),
            Arc::new(AtomicBool::new(false)),
        ));
        let old = super::AudioTestSession::new(sessions.clone(), &revision);
        assert_eq!(
            old.publish(&revision, || Ok("old meter")).unwrap(),
            "old meter"
        );
        sessions
            .with_stopped(|| {
                revision.commit(revision.next(0)?);
                Ok(())
            })
            .unwrap();
        assert!(old
            .publish(&revision, || -> Result<(), String> {
                panic!("old frame or terminal event acquired the successor revision")
            })
            .is_err());
        let current = super::AudioTestSession::new(sessions, &revision);
        assert_eq!(
            current.publish(&revision, || Ok("new meter")).unwrap(),
            "new meter"
        );
    }

    #[test]
    fn test_check_test_start() {
        // (stt_active, test_active, expect_ok)
        let cases = [
            (false, false, true),
            (false, true, false),
            (true, false, false),
            (true, true, false),
        ];
        for (stt, test, expect_ok) in cases {
            assert_eq!(
                check_test_start(stt, test).is_ok(),
                expect_ok,
                "stt_active={stt}, test_active={test}"
            );
        }
    }

    #[test]
    fn test_stt_guard_takes_priority() {
        assert_eq!(
            check_test_start(true, true).unwrap_err(),
            "Transcription is running — stop it before testing"
        );
    }
}
