#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, State};

use crate::events::{
    AudioLevelPayload, AudioTestStoppedPayload, EVENT_AUDIO_LEVEL, EVENT_AUDIO_TEST_STOPPED,
};
use crate::state::AppState;
use rhema_audio::{AudioConfig, AudioFrame, DeviceInfo};

/// Hard ceiling on a single test run — the thread self-stops afterwards so a
/// forgotten test can never leave the microphone open.
const TEST_TIMEOUT: Duration = Duration::from_secs(60);

/// List all available audio input devices.
#[tauri::command]
pub fn get_audio_devices(
    _state: State<'_, Mutex<AppState>>,
) -> Result<Vec<DeviceInfo>, String> {
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
    let test_active = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        check_test_start(
            app_state.stt_active.load(Ordering::SeqCst),
            app_state.audio_test_active.load(Ordering::SeqCst),
        )?;
        app_state.audio_test_active.clone()
    };

    test_active.store(true, Ordering::SeqCst);

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

            let capture =
                match rhema_audio::capture::start(config, audio_tx, device_lost.clone()) {
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
                            let _ = app.emit(
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
            let _ = app.emit(
                EVENT_AUDIO_LEVEL,
                AudioLevelPayload { rms: 0.0, peak: 0.0 },
            );
            let _ = app.emit(
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
