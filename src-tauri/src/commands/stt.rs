mod reading;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rhema_detection::fusion::{FTS5_CONFIDENCE_DECAY, FTS5_MIN_CONFIDENCE, FTS5_RANK0_CONFIDENCE};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::{
    AudioLevelPayload, TranscriptPayload, EVENT_AUDIO_LEVEL, EVENT_AUDIO_SOURCE_LOST,
    EVENT_AUDIO_SOURCE_RECOVERED, EVENT_TRANSCRIPT_FINAL, EVENT_TRANSCRIPT_PARTIAL,
};
use crate::state::AppState;
use crate::transcription_session::{SessionController, SessionToken};

/// Epoch milliseconds — the shared clock for `[LAT]` latency marks. The
/// frontend logs `Date.now()` through the `ui_mark` command, so backend and
/// webview timestamps interleave comparably in one log.
pub(crate) fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

/// Truncate a string to at most `max_bytes`, snapping to a valid UTF-8 char boundary.
fn truncate_safe(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}
use rhema_audio::{AudioConfig, AudioFrame};
use rhema_stt::{DeepgramClient, SttConfig, SttProvider, TranscriptEvent};

/// Start the full audio-capture-to-transcription pipeline.
///
/// 1. Opens the microphone via cpal (on a dedicated thread so the non-Send
///    `AudioCapture` never crosses thread boundaries).
/// 2. Connects to the selected STT provider (Deepgram cloud or Whisper local).
/// 3. Fans audio out to both the level meter (emits `audio_level` events) and STT.
/// 4. Receives transcripts and emits `transcript_partial` / `transcript_final` events.
/// 5. On final transcripts, runs the detection pipeline and emits `verse_detected` events.
#[expect(
    clippy::too_many_lines,
    reason = "pipeline setup is inherently complex"
)]
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    api_key: String,
    device_id: Option<String>,
    gain: Option<f32>,
    provider: Option<String>,
) -> Result<(), String> {
    // ── 1. Guard: already running? ──────────────────────────────────────
    let (sessions, audio_test_active) = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        if app_state.stt_active.load(Ordering::Relaxed) {
            return Err("Transcription is already running".into());
        }
        (
            app_state.transcription_sessions.clone(),
            app_state.audio_test_active.clone(),
        )
    };

    // Transcription preempts a running audio test — both would open the same
    // capture device. Clearing the flag makes the test thread exit within
    // ~100 ms; the short sleep lets its cpal stream drop first.
    if audio_test_active.swap(false, Ordering::SeqCst) {
        log::info!("Preempting running audio test for transcription");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let provider_name = provider.as_deref().unwrap_or("deepgram");

    // ── 2. Build the STT provider ───────────────────────────────────────
    let stt_provider: Arc<dyn SttProvider> = match provider_name {
        #[cfg(feature = "whisper")]
        "whisper" => {
            // Resolve bundled Whisper model path.
            // Dev: {CARGO_MANIFEST_DIR}/../models/whisper/ggml-large-v3-turbo-q8_0.bin
            // Prod: resource_dir()/models/whisper/ggml-large-v3-turbo-q8_0.bin
            let model_filename = "ggml-large-v3-turbo-q8_0.bin";
            let model_path = {
                let base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
                let dev_path = base_dir.join("models").join("whisper").join(model_filename);
                if dev_path.exists() {
                    dev_path
                } else {
                    app.path()
                        .resource_dir()
                        .map(|p| p.join("models").join("whisper").join(model_filename))
                        .ok()
                        .filter(|p| p.exists())
                        .ok_or_else(|| {
                            "Whisper model not found. Run: bun run download:whisper".to_string()
                        })?
                }
            };

            let parallelism = std::thread::available_parallelism().map_or(4, usize::from);
            let n_threads = i32::try_from(parallelism / 2).unwrap_or(2).max(1);

            log::info!(
                "Starting Whisper transcription: model={}, threads={n_threads}, device_id={device_id:?}",
                model_path.display()
            );

            Arc::new(rhema_stt::WhisperProvider::new(model_path, None, n_threads))
        }
        #[cfg(not(feature = "whisper"))]
        "whisper" => {
            return Err("Whisper support not compiled. Rebuild with --features whisper".into());
        }
        _ => {
            // Deepgram (default)
            let resolved_api_key = if api_key.is_empty() {
                std::env::var("DEEPGRAM_API_KEY").unwrap_or_default()
            } else {
                api_key
            };

            if resolved_api_key.is_empty() {
                return Err(
                    "No Deepgram API key provided. Set it in Settings or via DEEPGRAM_API_KEY env var."
                        .into(),
                );
            }

            // Never log key material: this file is exported by users for
            // support, and a prefix is still a prefix of a secret.
            log::info!(
                "Starting Deepgram transcription: api_key={}, device_id={device_id:?}, gain={gain:?}",
                if resolved_api_key.is_empty() { "missing" } else { "set" }
            );

            let stt_config = SttConfig {
                api_key: resolved_api_key,
                model: "nova-3".to_string(),
                sample_rate: 16_000,
                encoding: "linear16".to_string(),
                language: None,
            };

            Arc::new(DeepgramClient::new(stt_config))
        }
    };

    let session = sessions.start(|| reset_detection_context(&app))?;

    // ── 3. Prepare channels ─────────────────────────────────────────────
    let (audio_send_tx, audio_send_rx) = crossbeam_channel::bounded::<Vec<i16>>(64);

    // ── 4. Spawn the audio-capture + fan-out thread ─────────────────────
    // cpal's `Stream` (inside `AudioCapture`) is !Send, so we must create
    // and drop it on the same thread. This thread:
    //   a) starts the cpal capture
    //   b) reads AudioFrames
    //   c) computes levels → emits audio_level events
    //   d) forwards samples to STT provider via crossbeam
    let gain_val = gain.unwrap_or(1.0).clamp(0.0, 2.0);
    let fan_active = session.clone();
    let fan_sessions = sessions.clone();
    let fan_app = app.clone();

    std::thread::Builder::new()
        .name("audio-fanout".into())
        .spawn(move || {
            let _capture = match fan_sessions.capture_guard() {
                Ok(guard) => guard,
                Err(error) => {
                    log::error!("[AUDIO] Capture lock failed: {error}");
                    fan_sessions.finish(&fan_active);
                    return;
                }
            };
            if !fan_active.is_active() {
                return;
            }
            // Watchdog flag — set by cpal's stream-error callback when the OS
            // device vanishes. The outer loop polls this (and frame silence)
            // to detect loss and rebuild the capture once the device returns.
            let device_lost = Arc::new(AtomicBool::new(false));
            let mut frame_count: u64 = 0;
            let mut announced_lost = false;

            // Outer loop: rebuild `AudioCapture` whenever the device is lost
            // and reappears. Exits only when `fan_active` is cleared by
            // `stop_transcription`.
            'outer: loop {
                if !fan_active.is_active() {
                    break 'outer;
                }

                let config = AudioConfig {
                    device_id: device_id.clone(),
                    sample_rate: 16_000,
                    gain: gain_val,
                };

                let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);
                device_lost.store(false, Ordering::SeqCst);

                let capture =
                    match rhema_audio::capture::start(config, audio_tx, device_lost.clone()) {
                        Ok(c) => {
                            if announced_lost {
                                log::info!("[AUDIO] Source recovered — capture rebuilt");
                                emit_current(
                                    &fan_app,
                                    &fan_sessions,
                                    &fan_active,
                                    EVENT_AUDIO_SOURCE_RECOVERED,
                                    (),
                                );
                                announced_lost = false;
                            }
                            c
                        }
                        Err(e) => {
                            if !announced_lost {
                                log::warn!(
                                    "[AUDIO] Source unavailable: {e} — waiting for reconnect"
                                );
                                emit_current(
                                    &fan_app,
                                    &fan_sessions,
                                    &fan_active,
                                    EVENT_AUDIO_SOURCE_LOST,
                                    (),
                                );
                                announced_lost = true;
                                // Drop level meter to zero so UI reflects the gap.
                                emit_current(
                                    &fan_app,
                                    &fan_sessions,
                                    &fan_active,
                                    EVENT_AUDIO_LEVEL,
                                    AudioLevelPayload {
                                        rms: 0.0,
                                        peak: 0.0,
                                    },
                                );
                            }
                            std::thread::sleep(Duration::from_millis(750));
                            continue 'outer;
                        }
                    };

                log::info!("Audio capture started on fanout thread");

                let mut last_frame_at = Instant::now();

                // Inner loop: pump frames until loss is detected or stop is requested.
                loop {
                    if !fan_active.is_active() {
                        capture.stop();
                        break 'outer;
                    }

                    // Loss signal #1: cpal's err_fn fired.
                    // Loss signal #2: no frames for >2s (some platforms silently
                    // stop delivering rather than calling err_fn).
                    if device_lost.load(Ordering::SeqCst)
                        || last_frame_at.elapsed() > Duration::from_secs(2)
                    {
                        log::warn!(
                            "[AUDIO] Source lost (err_flag={}, silent_for={:?}) — dropping capture",
                            device_lost.load(Ordering::SeqCst),
                            last_frame_at.elapsed()
                        );
                        if !announced_lost {
                            emit_current(
                                &fan_app,
                                &fan_sessions,
                                &fan_active,
                                EVENT_AUDIO_SOURCE_LOST,
                                (),
                            );
                            emit_current(
                                &fan_app,
                                &fan_sessions,
                                &fan_active,
                                EVENT_AUDIO_LEVEL,
                                AudioLevelPayload {
                                    rms: 0.0,
                                    peak: 0.0,
                                },
                            );
                            announced_lost = true;
                        }
                        break; // drop `capture`, outer loop rebuilds
                    }

                    match audio_rx.recv_timeout(Duration::from_millis(100)) {
                        Ok(frame) => {
                            last_frame_at = Instant::now();
                            frame_count += 1;

                            // (a) Compute audio levels at ~15 Hz
                            //     At 16 kHz with ~1024-sample frames, every 4th frame is ~15 Hz.
                            if frame_count % 4 == 0 {
                                let level = rhema_audio::meter::compute_level(&frame.samples);
                                emit_current(
                                    &fan_app,
                                    &fan_sessions,
                                    &fan_active,
                                    EVENT_AUDIO_LEVEL,
                                    AudioLevelPayload {
                                        rms: level.rms,
                                        peak: level.peak,
                                    },
                                );
                            }

                            // (b) Forward all audio to STT provider
                            let _ = audio_send_tx.try_send(frame.samples);
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                            // Capture's sender was dropped — fall through to rebuild.
                            break;
                        }
                    }
                }

                // Dropping `capture` stops the cpal stream.
                capture.stop();
            }

            log::info!("Audio capture stopped on fanout thread");
        })
        .map_err(|e| {
            sessions.finish(&session);
            format!("Failed to spawn audio fanout thread: {e}")
        })?;

    // ── 5. Spawn the STT provider on the tokio runtime ──────────────────
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);

    let conn_session = session.clone();
    let conn_sessions = sessions.clone();
    let cancel_provider = stt_provider.clone();
    let cancel_session = session.clone();
    tauri::async_runtime::spawn(async move {
        cancel_session.cancelled().await;
        cancel_provider.stop();
    });
    let provider_log_name = stt_provider.name().to_string();

    // Task A: run the STT provider (Deepgram WS+REST or Whisper local).
    tauri::async_runtime::spawn(async move {
        let result = stt_provider.start(audio_send_rx, event_tx).await;
        if let Err(e) = result {
            log::error!("[STT-{provider_log_name}] Provider failed: {e}");
        }
        let _ = tokio::task::spawn_blocking(move || conn_sessions.finish(&conn_session)).await;
        log::info!("[STT-{provider_log_name}] Provider task exited");
    });

    // Task B: consume TranscriptEvents, emit to frontend, run detection
    let evt_session = session.clone();
    let evt_sessions = sessions.clone();
    let event_app = app.clone();

    // Background detection channel — direct + reading mode + FTS, non-blocking.
    // Carries (transcript, is_final): partials get instant direct-reference
    // detection; finals get the full pipeline.
    let (detect_tx, mut detect_rx) = tokio::sync::mpsc::channel::<(String, bool)>(16);

    // [DIAG] Counters so we can see whether transcripts are being dropped
    // because the detection worker can't keep up. Logged every 25 sends
    // alongside current queue depth.
    let detect_sent = Arc::new(AtomicU64::new(0));
    let detect_dropped = Arc::new(AtomicU64::new(0));

    // Spawn ONE detection worker that runs direct detection first, then the
    // FTS5 pass — sequentially. They used to run concurrently on the same
    // utterance and contended for the single SQLite connection mutex, which
    // pushed direct detection from ~1-2ms to ~18ms. Sequential also lets us
    // skip the FTS pass entirely when the utterance IS a spoken reference:
    // text-searching "Revelation chapter 3 verse 4" only yields junk hits
    // that pollute (and now replace) the semantic detections column.
    //
    // PARTIALS run direct detection only. Measured with the [LAT] timeline:
    // the complete reference text was legible in a Deepgram partial 2.8-5.4s
    // before the final arrived (endpointing holds the segment open while the
    // speaker keeps talking), and the entire post-final pipeline is ~50ms —
    // so finals-only detection made spoken references feel 3-5s slow. Direct
    // detection is ~1-3ms, cheap enough for every changed partial. Reading
    // mode and the FTS pass stay finals-only. Identical repeated partials
    // (Deepgram re-emits the same text ~1/s while audio continues) are
    // skipped.
    //
    // Uses spawn_blocking so mutex locks and DB I/O don't starve the tokio
    // runtime (WebSocket readers, event emitters, etc.).
    let det_app = app.clone();
    let det_session = session.clone();
    let det_sessions = sessions.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_partial = String::new();
        while let Some((transcript, is_final)) = detect_rx.recv().await {
            if is_final {
                last_partial.clear();
            } else {
                if transcript == last_partial {
                    continue;
                }
                last_partial = transcript.clone();
            }
            let app_clone = det_app.clone();
            let worker_session = det_session.clone();
            let worker_sessions = det_sessions.clone();
            let _ = tokio::task::spawn_blocking(move || {
                worker_sessions.with_current(&worker_session, || {
                    log::info!(
                        "[LAT] worker start t={} final={is_final} {:?}",
                        epoch_ms(),
                        truncate_safe(&transcript, 40)
                    );
                    let direct_found = run_direct_detection(&app_clone, &transcript);
                    if !is_final {
                        return;
                    }
                    check_reading_mode(&app_clone, &transcript, direct_found.as_ref());
                    if direct_found.is_some() {
                        log::info!("[DET-SEMANTIC] Skipped — utterance is a spoken reference");
                    } else {
                        run_semantic_detection(&app_clone, &transcript);
                    }
                })
            })
            .await;
        }
    });

    let detect_sent_evt = detect_sent.clone();
    let detect_dropped_evt = detect_dropped.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let sessions = evt_sessions.clone();
            let token = evt_session.clone();
            let app = event_app.clone();
            let tx = detect_tx.clone();
            let sent = detect_sent_evt.clone();
            let dropped = detect_dropped_evt.clone();
            let handled = tokio::task::spawn_blocking(move || {
                sessions.with_current(&token, || {
                    process_transcript_event(&app, event, &tx, &sent, &dropped);
                })
            })
            .await;
            if !matches!(handled, Ok(Some(()))) {
                break;
            }
        }

        log::info!("Transcript event consumer task exited");
    });

    Ok(())
}

/// Fan out one provider event while its run still owns the session boundary.
fn process_transcript_event(
    app: &AppHandle,
    event: TranscriptEvent,
    detect_tx: &tokio::sync::mpsc::Sender<(String, bool)>,
    detect_sent: &AtomicU64,
    detect_dropped: &AtomicU64,
) {
    match event {
        TranscriptEvent::Partial { transcript, .. } => {
            if !transcript.is_empty() {
                let t0 = std::time::Instant::now();
                log::info!(
                    "[LAT] partial t={} {:?}",
                    epoch_ms(),
                    truncate_safe(&transcript, 60)
                );
                let _ = app.emit(
                    EVENT_TRANSCRIPT_PARTIAL,
                    TranscriptPayload {
                        text: transcript.clone(),
                        is_final: false,
                        confidence: 0.0,
                    },
                );

                // Check for translation commands on partials too (cheap string matching)
                // This makes translation switching feel instant without waiting for speech_final
                check_translation_command(app, &transcript);

                // Direct reference detection on partials too: the full
                // reference is legible seconds before Deepgram issues
                // the final. Dropped silently if the worker is busy —
                // the final always follows and re-runs detection.
                let _ = detect_tx.try_send((transcript.clone(), false));
                log::debug!("[EVT] Partial processed in {:?}", t0.elapsed());
            }
        }
        TranscriptEvent::Final {
            transcript,
            confidence,
            speech_final: _,
            ..
        } => {
            if !transcript.is_empty() {
                let t0 = std::time::Instant::now();
                log::info!(
                    "[LAT] final t={} {:?}",
                    epoch_ms(),
                    truncate_safe(&transcript, 60)
                );
                // Emit as permanent transcript segment IMMEDIATELY
                // (never blocked by detection work)
                let _ = app.emit(
                    EVENT_TRANSCRIPT_FINAL,
                    TranscriptPayload {
                        text: transcript.clone(),
                        is_final: true,
                        confidence,
                    },
                );

                // Check for translation commands (cheap, <1ms, stays inline)
                check_translation_command(app, &transcript);

                // Fire-and-forget: detection runs in background thread pool.
                // Event consumer proceeds immediately to next transcript.
                if let Ok(()) = detect_tx.try_send((transcript.clone(), true)) {
                    let n = detect_sent.fetch_add(1, Ordering::Relaxed) + 1;
                    if n % 25 == 0 {
                        let depth = detect_tx.max_capacity() - detect_tx.capacity();
                        let dropped = detect_dropped.load(Ordering::Relaxed);
                        log::info!(
                            "[QUEUE] detect_tx sent={n} dropped={dropped} depth={depth}/{}",
                            detect_tx.max_capacity()
                        );
                    }
                } else {
                    let d = detect_dropped.fetch_add(1, Ordering::Relaxed) + 1;
                    let sent = detect_sent.load(Ordering::Relaxed);
                    log::warn!(
                        "[QUEUE] detect_tx DROPPED (consumer behind) sent={sent} dropped={d}"
                    );
                }

                log::debug!(
                    "[EVT] Final processed in {:?} ({:?})",
                    t0.elapsed(),
                    truncate_safe(&transcript, 40)
                );
            }
        }
        TranscriptEvent::UtteranceEnd => {}
        TranscriptEvent::SpeechStarted => {
            let _ = app.emit("stt_speech_started", ());
        }
        TranscriptEvent::Error(msg) => {
            log::error!("[STT] Error: {msg}");
            let _ = app.emit("stt_error", msg);
        }
        TranscriptEvent::Connected => {
            log::info!("[STT] Connected");
            let _ = app.emit("stt_connected", ());
        }
        TranscriptEvent::Disconnected => {
            log::warn!("[STT] Disconnected");
            let _ = app.emit("stt_disconnected", ());
        }
    }
}

/// Called only while the session boundary is held, before a new run becomes active.
fn reset_detection_context(app: &AppHandle) -> Result<(), String> {
    let detector_state = app.state::<Mutex<rhema_detection::DirectDetector>>();
    let reading_state = app.state::<Mutex<rhema_detection::ReadingMode>>();
    let merger_state = app.state::<Mutex<rhema_detection::DetectionMerger>>();
    let mut detector = detector_state.lock().map_err(|e| e.to_string())?;
    let mut reading = reading_state.lock().map_err(|e| e.to_string())?;
    let mut merger = merger_state.lock().map_err(|e| e.to_string())?;
    reset_detection_components(&mut detector, &mut reading, &mut merger);
    Ok(())
}

fn reset_detection_components(
    detector: &mut rhema_detection::DirectDetector,
    reading: &mut rhema_detection::ReadingMode,
    merger: &mut rhema_detection::DetectionMerger,
) {
    *detector = rhema_detection::DirectDetector::new();
    *reading = rhema_detection::ReadingMode::new();
    merger.reset_session();
}

fn emit_current<S: serde::Serialize + Clone>(
    app: &AppHandle,
    sessions: &SessionController,
    token: &SessionToken,
    event: &str,
    payload: S,
) {
    let _ = sessions.with_current(token, || app.emit(event, payload));
}

/// Run direct (regex/pattern) detection only. Instant, no ONNX.
/// Uses SEPARATE Mutex<DirectDetector> and Mutex<DetectionMerger> so it
/// never blocks on the semantic worker, and cooldown state persists across calls.
/// Returns a resolved emitted reference at its real high confidence (>= 0.90).
#[expect(
    clippy::similar_names,
    reason = "merger and merged are naturally named"
)]
fn run_direct_detection(app: &AppHandle, transcript: &str) -> Option<rhema_detection::VerseRef> {
    use rhema_detection::{DetectionMerger, DirectDetector};

    let t0 = std::time::Instant::now();
    let detector_state: State<'_, Mutex<DirectDetector>> = app.state();
    let mut detector = match detector_state.lock() {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to lock DirectDetector: {e}");
            return None;
        }
    };
    let direct_results = detector.detect(transcript);
    drop(detector); // Release immediately

    if direct_results.is_empty() {
        return None;
    }

    // Merge using the managed merger (persists cooldown state across calls,
    // preventing duplicate emissions when running on both partials and finals)
    let merger_state: State<'_, Mutex<DetectionMerger>> = app.state();
    let mut merger = match merger_state.lock() {
        Ok(m) => m,
        Err(e) => {
            log::error!("Failed to lock DetectionMerger: {e}");
            return None;
        }
    };
    let merged = merger.merge(direct_results, vec![]);
    drop(merger);
    if merged.is_empty() {
        return None;
    }

    // Resolve verse info from DB (needs AppState, but only briefly for DB lookup).
    // Blocking lock is OK — we're inside spawn_blocking. Emitting detections
    // without verse text (the old try_lock fallback) left auto-queued items
    // with an empty text field (issue #103).
    let app_managed: State<'_, Mutex<AppState>> = app.state();
    let app_state = match app_managed.lock() {
        Ok(s) => s,
        Err(e) => {
            log::error!("[DET-DIRECT] Failed to lock AppState for verse resolution: {e}");
            return None;
        }
    };
    let mut results: Vec<super::detection::DetectionResult> = merged
        .iter()
        .map(|m| super::detection::to_result(&app_state, m))
        .collect();

    // Backstop for issue #141: the detector validates against union-max verse
    // counts across all translations, so a verse can still be missing from
    // the *active* translation. Never emit a detection with no text.
    if app_state.bible_db.is_some() {
        results.retain(|r| {
            if r.verse_text.is_empty() {
                log::warn!(
                    "[DET-DIRECT] Dropping {} — verse not found in active translation",
                    r.verse_ref
                );
                false
            } else {
                true
            }
        });
    }

    for r in &results {
        log::info!(
            "[DET-DIRECT] Found: {} ({:.0}%)",
            r.verse_ref,
            r.confidence * 100.0
        );
    }
    drop(app_state);
    if results.is_empty() {
        return None;
    }
    log::info!(
        "[LAT] emit verse_detections t={} src=direct n={} first={:?}",
        epoch_ms(),
        results.len(),
        results.first().map_or("", |r| r.verse_ref.as_str())
    );
    if let Err(error) = app.emit("verse_detections", &results) {
        log::warn!("[DET-DIRECT] Failed to emit accepted results: {error}");
        return None;
    }
    log::info!(
        "[DET-DIRECT] Detection took {:?} for {:?}",
        t0.elapsed(),
        truncate_safe(transcript, 50)
    );
    accepted_direct_reference(&results)
}

/// Run FTS5-only detection. ONNX/vector pipeline is skipped for speed.
/// FTS5 phrase match finds exact scripture quotes; direct detection handles
/// verse references; ONNX can be re-enabled later with parallelized vector search.
fn run_semantic_detection(app: &AppHandle, transcript: &str) {
    let t0 = std::time::Instant::now();
    log::info!(
        "[DET-SEMANTIC] Running on: {:?}",
        truncate_safe(transcript, 80)
    );

    // FTS5 BM25 phrase search (~5ms)
    let fts_results = {
        let managed: State<'_, Mutex<AppState>> = app.state();
        let Ok(app_state) = managed.lock() else {
            log::error!("Failed to lock AppState for FTS5");
            return;
        };
        app_state
            .bible_db
            .as_ref()
            .and_then(|db| db.search_verses_bm25(transcript, 10).ok())
    };

    let Some(fts) = fts_results else {
        log::info!("[DET-SEMANTIC] No FTS5 results");
        return;
    };
    if fts.is_empty() {
        log::info!("[DET-SEMANTIC] No FTS5 results");
        return;
    }

    // Build results directly from FTS5 hits — no ONNX, no vector search.
    // Resolve verse text from DB for each FTS5 hit.
    let managed: State<'_, Mutex<AppState>> = app.state();
    let Ok(app_state) = managed.lock() else {
        log::error!("Failed to lock AppState for verse resolution");
        return;
    };

    let results: Vec<super::detection::DetectionResult> = fts
        .iter()
        .enumerate()
        .filter_map(|(rank, hit)| {
            #[expect(clippy::cast_precision_loss, reason = "rank is small")]
            let confidence = FTS5_RANK0_CONFIDENCE - (rank as f64 * FTS5_CONFIDENCE_DECAY);
            if confidence < FTS5_MIN_CONFIDENCE {
                return None;
            }

            // Resolve verse text from active translation
            let verse_text = app_state
                .bible_db
                .as_ref()
                .and_then(|db| {
                    db.get_verse(
                        app_state.active_translation_id,
                        hit.book_number,
                        hit.chapter,
                        hit.verse,
                    )
                    .ok()
                    .flatten()
                })
                .map(|v| v.text)
                .unwrap_or_default();

            if verse_text.trim().is_empty() {
                return None;
            }
            Some(super::detection::DetectionResult {
                verse_ref: format!("{} {}:{}", hit.book_name, hit.chapter, hit.verse),
                verse_text,
                book_name: hit.book_name.clone(),
                book_number: hit.book_number,
                chapter: hit.chapter,
                verse: hit.verse,
                confidence,
                source: "semantic".to_string(),
                translation_id: Some(app_state.active_translation_id),
                translation_code: super::detection::translation_code(
                    &app_state,
                    Some(app_state.active_translation_id),
                ),
                score_kind: "fts_rank",
                auto_queued: false,
                transcript_snippet: truncate_safe(transcript, 100).to_string(),
                is_chapter_only: false,
            })
        })
        .collect();

    if results.is_empty() {
        log::info!("[DET-SEMANTIC] No detections");
        return;
    }

    for r in &results {
        log::info!(
            "[DET-SEMANTIC] Found: {} ({:.0}% {}) auto_q={}",
            r.verse_ref,
            r.confidence * 100.0,
            r.source,
            r.auto_queued
        );
    }
    drop(app_state);
    log::info!(
        "[LAT] emit verse_detections t={} src=semantic n={} first={:?}",
        epoch_ms(),
        results.len(),
        results.first().map_or("", |r| r.verse_ref.as_str())
    );
    let _ = app.emit("verse_detections", &results);
    log::info!("[DET-SEMANTIC] Total: {:?}", t0.elapsed());
}

/// Input is the confidence-ordered list after active-translation resolution/filtering.
fn accepted_direct_reference(
    results: &[super::detection::DetectionResult],
) -> Option<rhema_detection::VerseRef> {
    let accepted = results.iter().find(|result| {
        result.confidence.is_finite()
            && result.confidence >= 0.90
            && !result.verse_text.trim().is_empty()
    })?;
    Some(rhema_detection::VerseRef {
        book_number: accepted.book_number,
        book_name: accepted.book_name.clone(),
        chapter: accepted.chapter,
        verse_start: accepted.verse,
        verse_end: None,
    })
}

fn should_start_reading(
    reading: &rhema_detection::ReadingMode,
    reference: &rhema_detection::VerseRef,
) -> bool {
    !reading.is_active()
        || reading.current_book() != reference.book_number
        || reading.current_chapter() != reference.chapter
        || reading.current_verse() != Some(reference.verse_start)
}

/// Apply one reading transition while the caller retains the native session boundary.
fn check_reading_mode(
    app: &AppHandle,
    transcript: &str,
    accepted: Option<&rhema_detection::VerseRef>,
) -> bool {
    let mentioned = app
        .state::<Mutex<rhema_detection::DirectDetector>>()
        .lock()
        .map(|detector| detector.mentioned_books(transcript))
        .unwrap_or_default();
    let reading_state = app.state::<Mutex<rhema_detection::ReadingMode>>();
    let Ok(mut reading) = reading_state.lock() else {
        return false;
    };
    let advance = reading::apply_reading_transcript(
        &mut reading,
        accepted,
        transcript,
        &mentioned,
        |book, chapter| {
            let state = app.state::<Mutex<AppState>>();
            let state = state.lock().ok()?;
            Some(
                state
                    .bible_db
                    .as_ref()?
                    .get_chapter(state.active_translation_id, book, chapter)
                    .ok()?
                    .into_iter()
                    .map(|verse| (verse.verse, verse.text))
                    .collect(),
            )
        },
    );
    drop(reading);
    if let Some(advance) = advance {
        let _ = app.emit("reading_mode_verse", &advance);
        return true;
    }
    accepted.is_some()
}

/// Check for voice translation commands like "read in NIV", "switch to ESV".
fn check_translation_command(app: &AppHandle, transcript: &str) {
    #[derive(serde::Serialize, Clone)]
    struct TranslationSwitch {
        abbreviation: String,
        translation_id: i64,
    }

    let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
    let Ok(detector) = detector_state.lock() else {
        return;
    };

    if let Some(abbrev) = detector.detect_translation_command(transcript) {
        drop(detector);

        // Find the translation ID for this abbreviation
        let managed: State<'_, Mutex<AppState>> = app.state();
        let Ok(mut app_state) = managed.try_lock() else {
            return;
        };

        if let Some(ref db) = app_state.bible_db {
            if let Ok(translations) = db.list_translations() {
                if let Some(t) = translations.iter().find(|t| t.abbreviation == abbrev) {
                    app_state.active_translation_id = t.id;
                    log::info!("[STT] Voice command: switched to {abbrev} (id={})", t.id);
                    drop(app_state);

                    let _ = app.emit(
                        "translation_command",
                        TranslationSwitch {
                            abbreviation: abbrev,
                            translation_id: t.id,
                        },
                    );
                }
            }
        }
    }
}

/// Stop the transcription pipeline (audio capture + STT provider).
#[tauri::command]
pub async fn stop_transcription(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let sessions = state
        .lock()
        .map_err(|e| e.to_string())?
        .transcription_sessions
        .clone();
    tokio::task::spawn_blocking(move || sessions.stop())
        .await
        .map_err(|e| e.to_string())??;
    log::info!("Transcription stopped; obsolete work is cancelled");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_detection::{DetectionMerger, DirectDetector, ReadingMode};

    #[test]
    fn restart_resets_context_reading_and_cooldown_and_rejects_old_work() {
        let state = AppState::new();
        let sessions = state.transcription_sessions;
        let mut detector = DirectDetector::new();
        let mut reading = ReadingMode::new();
        let mut merger = DetectionMerger::new();
        merger.set_cooldown_ms(60_000);
        merger.set_confidence_threshold(0.94);
        let first = sessions.start(|| Ok(())).unwrap();
        sessions.with_current(&first, || {
            let found = detector.detect("John 3:16");
            assert!(merger.merge(found, vec![])[0].auto_queued);
            reading.start(
                43,
                "John",
                3,
                16,
                vec![(16, "For God so loved the world".into())],
            );
        });
        sessions.stop().unwrap();
        let current = sessions
            .start(|| {
                reset_detection_components(&mut detector, &mut reading, &mut merger);
                Ok(())
            })
            .unwrap();
        assert!(sessions
            .with_current(&first, || detector.detect("Mark 2:5"))
            .is_none());
        sessions
            .with_current(&current, || {
                assert!(detector.detect("verse 17").is_empty());
                assert!(!reading.has_verses());
                let found = detector.detect("John 3:16");
                assert!(
                    merger.merge(found, vec![])[0].auto_queued,
                    "old cooldown survived restart"
                );
                let low = detector.detect("3:17");
                assert!(
                    merger.merge(low, vec![]).is_empty(),
                    "custom threshold was lost"
                );
            })
            .unwrap();
    }
    fn resolved(
        book: i32,
        chapter: i32,
        verse: i32,
        confidence: f64,
        text: &str,
    ) -> super::super::detection::DetectionResult {
        super::super::detection::DetectionResult {
            verse_ref: format!("Book {book} {chapter}:{verse}"),
            verse_text: text.into(),
            book_name: format!("Book {book}"),
            book_number: book,
            chapter,
            verse,
            confidence,
            source: "direct".into(),
            auto_queued: false,
            transcript_snippet: "Synthetic citation fixture".into(),
            is_chapter_only: false,
        }
    }
    #[test]
    fn reading_handoff_uses_a_resolved_emitted_reference_with_its_real_confidence() {
        let results = vec![
            resolved(43, 3, 16, 0.99, "Accepted John text"),
            resolved(41, 2, 5, 0.70, "Later low confidence candidate"),
        ];
        let accepted = accepted_direct_reference(&results).unwrap();
        assert_eq!(
            (accepted.book_number, accepted.chapter, accepted.verse_start),
            (43, 3, 16)
        );
        for candidate in [
            resolved(41, 2, 5, 0.70, "Only lower-confidence survivor"),
            resolved(41, 2, 5, 0.99, ""),
            resolved(41, 2, 5, f64::NAN, "text"),
            resolved(41, 2, 5, f64::INFINITY, "text"),
        ] {
            assert!(accepted_direct_reference(&[candidate]).is_none());
        }
        assert!(accepted_direct_reference(&[]).is_none());
    }
    #[test]
    fn explicit_same_chapter_navigation_updates_the_reading_position() {
        let mut reading = ReadingMode::new();
        reading.start(
            43,
            "John",
            3,
            16,
            vec![(16, "Current text".into()), (18, "Target text".into())],
        );
        for (book, chapter, verse, expected) in [
            (43, 3, 16, false),
            (43, 3, 18, true),
            (43, 4, 1, true),
            (41, 2, 5, true),
        ] {
            let reference =
                accepted_direct_reference(&[resolved(book, chapter, verse, 0.99, "Valid text")])
                    .unwrap();
            assert_eq!(should_start_reading(&reading, &reference), expected);
        }
    }
}
