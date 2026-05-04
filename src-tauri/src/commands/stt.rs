#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::{
    AudioLevelPayload, TranscriptPayload, EVENT_AUDIO_LEVEL, EVENT_AUDIO_SOURCE_LOST,
    EVENT_AUDIO_SOURCE_RECOVERED, EVENT_TRANSCRIPT_FINAL, EVENT_TRANSCRIPT_PARTIAL,
};
use crate::state::AppState;

/// [DIAG] Running totals for AppState mutex contention on the direct-detection
/// hot path. Direct-mode detection runs on every Final transcript fragment
/// inside spawn_blocking, so high contention here means workers are stalling.
static DIRECT_LOCK_OK: AtomicU64 = AtomicU64::new(0);
static DIRECT_LOCK_CONTENDED: AtomicU64 = AtomicU64::new(0);

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
#[expect(clippy::too_many_lines, reason = "pipeline setup is inherently complex")]
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
    let (stt_active, audio_active) = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        if app_state.stt_active.load(Ordering::Relaxed) {
            return Err("Transcription is already running".into());
        }
        (app_state.stt_active.clone(), app_state.audio_active.clone())
    };

    let provider_name = provider.as_deref().unwrap_or("deepgram");

    // ── 2. Build the STT provider ───────────────────────────────────────
    let stt_provider: Box<dyn SttProvider> = match provider_name {
        #[cfg(feature = "whisper")]
        "whisper" => {
            // Resolve bundled Whisper model path.
            // Dev: {CARGO_MANIFEST_DIR}/../models/whisper/ggml-large-v3-turbo-q8_0.bin
            // Prod: resource_dir()/models/whisper/ggml-large-v3-turbo-q8_0.bin
            let model_filename = "ggml-large-v3-turbo-q8_0.bin";
            let model_path = {
                let base_dir =
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
                let dev_path = base_dir
                    .join("models")
                    .join("whisper")
                    .join(model_filename);
                if dev_path.exists() {
                    dev_path
                } else {
                    app.path()
                        .resource_dir()
                        .map(|p| {
                            p.join("models")
                                .join("whisper")
                                .join(model_filename)
                        })
                        .ok()
                        .filter(|p| p.exists())
                        .ok_or_else(|| {
                            "Whisper model not found. Run: bun run download:whisper"
                                .to_string()
                        })?
                }
            };

            let parallelism = std::thread::available_parallelism()
                .map_or(4, usize::from);
            let n_threads = i32::try_from(parallelism / 2).unwrap_or(2).max(1);

            log::info!(
                "Starting Whisper transcription: model={}, threads={n_threads}, device_id={device_id:?}",
                model_path.display()
            );

            Box::new(rhema_stt::WhisperProvider::new(
                model_path,
                None,
                n_threads,
            ))
        }
        #[cfg(not(feature = "whisper"))]
        "whisper" => {
            return Err(
                "Whisper support not compiled. Rebuild with --features whisper".into(),
            );
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

            log::info!(
                "Starting Deepgram transcription: api_key={}..., device_id={device_id:?}, gain={gain:?}",
                truncate_safe(&resolved_api_key, 8)
            );

            let stt_config = SttConfig {
                api_key: resolved_api_key,
                model: "nova-3".to_string(),
                sample_rate: 16_000,
                encoding: "linear16".to_string(),
                language: None,
            };

            Box::new(DeepgramClient::new(stt_config))
        }
    };

    stt_active.store(true, Ordering::SeqCst);
    audio_active.store(true, Ordering::SeqCst);

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
    let fan_active = stt_active.clone();
    let fan_app = app.clone();

    std::thread::Builder::new()
        .name("audio-fanout".into())
        .spawn(move || {
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
                if !fan_active.load(Ordering::SeqCst) {
                    break 'outer;
                }

                let config = AudioConfig {
                    device_id: device_id.clone(),
                    sample_rate: 16_000,
                    gain: gain_val,
                };

                let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);
                device_lost.store(false, Ordering::SeqCst);

                let capture = match rhema_audio::capture::start(
                    config,
                    audio_tx,
                    device_lost.clone(),
                ) {
                    Ok(c) => {
                        if announced_lost {
                            log::info!("[AUDIO] Source recovered — capture rebuilt");
                            let _ = fan_app.emit(EVENT_AUDIO_SOURCE_RECOVERED, ());
                            announced_lost = false;
                        }
                        c
                    }
                    Err(e) => {
                        if !announced_lost {
                            log::warn!(
                                "[AUDIO] Source unavailable: {e} — waiting for reconnect"
                            );
                            let _ = fan_app.emit(EVENT_AUDIO_SOURCE_LOST, ());
                            announced_lost = true;
                            // Drop level meter to zero so UI reflects the gap.
                            let _ = fan_app.emit(
                                EVENT_AUDIO_LEVEL,
                                AudioLevelPayload { rms: 0.0, peak: 0.0 },
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
                    if !fan_active.load(Ordering::SeqCst) {
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
                            let _ = fan_app.emit(EVENT_AUDIO_SOURCE_LOST, ());
                            let _ = fan_app.emit(
                                EVENT_AUDIO_LEVEL,
                                AudioLevelPayload { rms: 0.0, peak: 0.0 },
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
                                let _ = fan_app.emit(
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
            stt_active.store(false, Ordering::SeqCst);
            audio_active.store(false, Ordering::SeqCst);
            format!("Failed to spawn audio fanout thread: {e}")
        })?;

    // ── 5. Spawn the STT provider on the tokio runtime ──────────────────
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);

    let conn_active = stt_active.clone();
    let provider_log_name = stt_provider.name().to_string();

    // Task A: run the STT provider (Deepgram WS+REST or Whisper local).
    tauri::async_runtime::spawn(async move {
        let result = stt_provider.start(audio_send_rx, event_tx).await;
        if let Err(e) = result {
            log::error!("[STT-{provider_log_name}] Provider failed: {e}");
        }
        conn_active.store(false, Ordering::SeqCst);
        log::info!("[STT-{provider_log_name}] Provider task exited");
    });

    // Task B: consume TranscriptEvents, emit to frontend, run detection
    let evt_active = stt_active.clone();
    let event_app = app.clone();

    // Background semantic detection channel — non-blocking, drops if busy
    let (semantic_tx, mut semantic_rx) = tokio::sync::mpsc::channel::<String>(4);

    // Background detection channel — direct + reading mode, non-blocking
    let (detect_tx, mut detect_rx) = tokio::sync::mpsc::channel::<String>(16);

    // [DIAG] Counters so we can see whether transcripts are being dropped
    // because the detection workers can't keep up. Logged every 25 sends
    // alongside current queue depth.
    let detect_sent = Arc::new(AtomicU64::new(0));
    let detect_dropped = Arc::new(AtomicU64::new(0));
    let semantic_sent = Arc::new(AtomicU64::new(0));
    let semantic_dropped = Arc::new(AtomicU64::new(0));

    // Spawn semantic detection worker (runs ONNX inference without blocking transcript).
    // Uses spawn_blocking so ONNX doesn't starve the tokio async runtime
    // (WebSocket readers, event emitters, etc.).
    let sem_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(text) = semantic_rx.recv().await {
            let app_clone = sem_app.clone();
            let _ = tokio::task::spawn_blocking(move || {
                run_semantic_detection(&app_clone, &text);
            })
            .await;
        }
    });

    // Spawn detection worker (runs direct detection + reading mode without blocking
    // transcript delivery). Uses spawn_blocking so mutex locks and DB I/O don't
    // starve the tokio runtime.
    let det_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(transcript) = detect_rx.recv().await {
            let app_clone = det_app.clone();
            let _ = tokio::task::spawn_blocking(move || {
                let direct_found = run_direct_detection(&app_clone, &transcript);
                check_reading_mode(&app_clone, &transcript, direct_found);
            })
            .await;
        }
    });

    let detect_sent_evt = detect_sent.clone();
    let detect_dropped_evt = detect_dropped.clone();
    let semantic_sent_evt = semantic_sent.clone();
    let semantic_dropped_evt = semantic_dropped.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if !evt_active.load(Ordering::SeqCst) {
                break;
            }

            match event {
                TranscriptEvent::Partial { transcript, .. } => {
                    if !transcript.is_empty() {
                        let t0 = std::time::Instant::now();
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_PARTIAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: false,
                                confidence: 0.0,
                            },
                        );

                        // Check for translation commands on partials too (cheap string matching)
                        // This makes translation switching feel instant without waiting for speech_final
                        check_translation_command(&event_app, &transcript);
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
                        // Emit as permanent transcript segment IMMEDIATELY
                        // (never blocked by detection work)
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_FINAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: true,
                                confidence,
                            },
                        );

                        // Check for translation commands (cheap, <1ms, stays inline)
                        check_translation_command(&event_app, &transcript);

                        // Fire-and-forget: detection runs in background thread pool.
                        // Event consumer proceeds immediately to next transcript.
                        match detect_tx.try_send(transcript.clone()) {
                            Ok(()) => {
                                let n = detect_sent_evt.fetch_add(1, Ordering::Relaxed) + 1;
                                if n % 25 == 0 {
                                    let depth = detect_tx.max_capacity() - detect_tx.capacity();
                                    let dropped = detect_dropped_evt.load(Ordering::Relaxed);
                                    log::info!(
                                        "[QUEUE] detect_tx sent={n} dropped={dropped} depth={depth}/{}",
                                        detect_tx.max_capacity()
                                    );
                                }
                            }
                            Err(_) => {
                                let d = detect_dropped_evt.fetch_add(1, Ordering::Relaxed) + 1;
                                let sent = detect_sent_evt.load(Ordering::Relaxed);
                                log::warn!(
                                    "[QUEUE] detect_tx DROPPED (consumer behind) sent={sent} dropped={d}"
                                );
                            }
                        }

                        // Send every is_final fragment to FTS5 immediately.
                        // No sentence buffer — FTS5 is fast enough (~20-50ms)
                        // to run on every fragment without waiting for pauses.
                        match semantic_tx.try_send(transcript.clone()) {
                            Ok(()) => {
                                let n = semantic_sent_evt.fetch_add(1, Ordering::Relaxed) + 1;
                                if n % 25 == 0 {
                                    let depth = semantic_tx.max_capacity() - semantic_tx.capacity();
                                    let dropped = semantic_dropped_evt.load(Ordering::Relaxed);
                                    log::info!(
                                        "[QUEUE] semantic_tx sent={n} dropped={dropped} depth={depth}/{}",
                                        semantic_tx.max_capacity()
                                    );
                                }
                            }
                            Err(_) => {
                                let d = semantic_dropped_evt.fetch_add(1, Ordering::Relaxed) + 1;
                                let sent = semantic_sent_evt.load(Ordering::Relaxed);
                                log::warn!(
                                    "[QUEUE] semantic_tx DROPPED (consumer behind) sent={sent} dropped={d}"
                                );
                            }
                        }

                        log::debug!("[EVT] Final processed in {:?} ({:?})", t0.elapsed(), truncate_safe(&transcript, 40));
                    }
                }
                TranscriptEvent::UtteranceEnd => {}
                TranscriptEvent::SpeechStarted => {
                    let _ = event_app.emit("stt_speech_started", ());
                }
                TranscriptEvent::Error(msg) => {
                    log::error!("[STT] Error: {msg}");
                    let _ = event_app.emit("stt_error", msg);
                }
                TranscriptEvent::Connected => {
                    log::info!("[STT] Connected");
                    let _ = event_app.emit("stt_connected", ());
                }
                TranscriptEvent::Disconnected => {
                    log::warn!("[STT] Disconnected");
                    let _ = event_app.emit("stt_disconnected", ());
                }
            }
        }

        log::info!("Transcript event consumer task exited");
    });

    Ok(())
}

/// Run direct (regex/pattern) detection only. Instant, no ONNX.
/// Uses SEPARATE Mutex<DirectDetector> and Mutex<DetectionMerger> so it
/// never blocks on the semantic worker, and cooldown state persists across calls.
/// Returns true if high-confidence results were found (>= 0.90).
#[expect(clippy::similar_names, reason = "merger and merged are naturally named")]
fn run_direct_detection(app: &AppHandle, transcript: &str) -> bool {
    use rhema_detection::{DirectDetector, DetectionMerger};

    let t0 = std::time::Instant::now();
    let detector_state: State<'_, Mutex<DirectDetector>> = app.state();
    let mut detector = match detector_state.lock() {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to lock DirectDetector: {e}");
            return false;
        }
    };
    let direct_results = detector.detect(transcript);
    drop(detector); // Release immediately

    if direct_results.is_empty() {
        return false;
    }

    // Check if any result has high confidence before merging
    let has_high_confidence = direct_results.iter().any(|d| d.confidence >= 0.90);

    // Merge using the managed merger (persists cooldown state across calls,
    // preventing duplicate emissions when running on both partials and finals)
    let merger_state: State<'_, Mutex<DetectionMerger>> = app.state();
    let mut merger = match merger_state.lock() {
        Ok(m) => m,
        Err(e) => {
            log::error!("Failed to lock DetectionMerger: {e}");
            return false;
        }
    };
    let merged = merger.merge(direct_results, vec![]);
    drop(merger);
    if merged.is_empty() {
        return false;
    }

    // Resolve verse info from DB (needs AppState, but only briefly for DB lookup)
    let app_managed: State<'_, Mutex<AppState>> = app.state();
    let Ok(app_state) = app_managed.try_lock() else {
        let bad = DIRECT_LOCK_CONTENDED.fetch_add(1, Ordering::Relaxed) + 1;
        let good = DIRECT_LOCK_OK.load(Ordering::Relaxed);
        log::warn!(
            "[DET-DIRECT] AppState try_lock FAILED (contention) ok={good} contended={bad} — emitting without verse text"
        );
        // AppState locked — emit results without verse text
        let results: Vec<super::detection::DetectionResult> = merged
            .iter()
            .map(|m| {
                let vr = &m.detection.verse_ref;
                super::detection::DetectionResult {
                    verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
                    verse_text: String::new(),
                    book_name: vr.book_name.clone(),
                    book_number: vr.book_number,
                    chapter: vr.chapter,
                    verse: vr.verse_start,
                    confidence: m.detection.confidence,
                    source: "direct".to_string(),
                    auto_queued: m.auto_queued,
                    transcript_snippet: m.detection.transcript_snippet.clone(),
                    is_chapter_only: m.detection.is_chapter_only,
                }
            })
            .collect();
        for r in &results {
            log::info!("[DET-DIRECT] Found: {} ({:.0}%) (no DB)", r.verse_ref, r.confidence * 100.0);
        }
        let _ = app.emit("verse_detections", &results);
        return has_high_confidence;
    };
    let ok = DIRECT_LOCK_OK.fetch_add(1, Ordering::Relaxed) + 1;
    if ok % 50 == 0 {
        let bad = DIRECT_LOCK_CONTENDED.load(Ordering::Relaxed);
        log::info!("[DET-DIRECT] AppState lock stats ok={ok} contended={bad}");
    }
    let results: Vec<super::detection::DetectionResult> = merged
        .iter()
        .map(|m| super::detection::to_result(&app_state, m))
        .collect();

    for r in &results {
        log::info!("[DET-DIRECT] Found: {} ({:.0}%)", r.verse_ref, r.confidence * 100.0);
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
    log::info!("[DET-DIRECT] Detection took {:?} for {:?}", t0.elapsed(), truncate_safe(transcript, 50));
    has_high_confidence
}

/// Run FTS5-only detection. ONNX/vector pipeline is skipped for speed.
/// FTS5 phrase match finds exact scripture quotes; direct detection handles
/// verse references; ONNX can be re-enabled later with parallelized vector search.
fn run_semantic_detection(app: &AppHandle, transcript: &str) {
    let t0 = std::time::Instant::now();
    log::info!("[DET-SEMANTIC] Running on: {:?}", truncate_safe(transcript, 80));

    // FTS5 BM25 phrase search (~5ms)
    let fts_results = {
        let managed: State<'_, Mutex<AppState>> = app.state();
        let Ok(app_state) = managed.lock() else {
            log::error!("Failed to lock AppState for FTS5");
            return;
        };
        app_state.bible_db.as_ref().and_then(|db| {
            db.search_verses_bm25(transcript, 10).ok()
        })
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

    use super::detection::{FTS5_RANK0_CONFIDENCE, FTS5_CONFIDENCE_DECAY, FTS5_MIN_CONFIDENCE};

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
            let verse_text = app_state.bible_db.as_ref()
                .and_then(|db| {
                    db.get_verse(
                        app_state.active_translation_id,
                        hit.book_number,
                        hit.chapter,
                        hit.verse,
                    ).ok().flatten()
                })
                .map(|v| v.text)
                .unwrap_or_default();

            Some(super::detection::DetectionResult {
                verse_ref: format!("{} {}:{}", hit.book_name, hit.chapter, hit.verse),
                verse_text,
                book_name: hit.book_name.clone(),
                book_number: hit.book_number,
                chapter: hit.chapter,
                verse: hit.verse,
                confidence,
                source: "semantic".to_string(),
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
            r.verse_ref, r.confidence * 100.0, r.source, r.auto_queued
        );
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
    log::info!("[DET-SEMANTIC] Total: {:?}", t0.elapsed());
}

/// Check reading mode: if active, test transcript against expected verse.
/// If direct detection just found a new verse, start/restart reading mode.
/// Returns `true` when reading mode handled the transcript (suppresses semantic).
#[expect(clippy::too_many_lines, reason = "sequential state-machine logic is clearer in one flow")]
fn check_reading_mode(app: &AppHandle, transcript: &str, direct_found: bool) -> bool {
    use rhema_detection::ReadingMode;

    // If direct detection found a verse, consider starting/restarting reading mode.
    // BUT: if reading mode is already active on a book/chapter, do NOT restart
    // on a different book — false positives from bare numbers (e.g., "verse 5"
    // getting matched as "Job 3:5") would hijack the reading session.
    if direct_found {
        let verse_info = {
            let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
            let Ok(detector) = detector_state.lock() else { return false };
            detector.recent_detections().front().cloned()
        };

        if let Some(recent) = verse_info {
            // Get the confidence of the detection to distinguish explicit refs from false positives
            let detection_confidence = {
                let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
                detector_state.lock().ok()
                    .and_then(|d| d.recent_detections().front().map(|_| 0.95)) // Direct detections are always high confidence
                    .unwrap_or(0.0)
            };

            let should_start = {
                let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
                match rm_managed.lock() {
                    Ok(rm) => {
                        if !rm.is_active() && !rm.has_verses() {
                            true // Not active, no verses loaded — start fresh
                        } else if !rm.is_active() && rm.has_verses() {
                            // Paused — restart on any new explicit reference
                            true
                        } else if rm.current_book() == recent.book_number
                            && rm.current_chapter() == recent.chapter {
                            false // Same book+chapter — already tracking this
                        } else if rm.current_book() != recent.book_number
                            && detection_confidence >= 0.90 {
                            // Different book with high confidence — explicit new reference
                            // (e.g., "John 1:1" after reading Exodus). Restart.
                            true
                        } else if rm.current_book() == recent.book_number {
                            // Same book, different chapter — natural progression
                            true
                        } else {
                            // Different book, low confidence — likely false positive
                            false
                        }
                    }
                    Err(_) => false,
                }
            };

            if should_start {
                let chapter_data = {
                    let t_db = std::time::Instant::now();
                    let app_managed: State<'_, Mutex<crate::state::AppState>> = app.state();
                    // Blocking lock is OK — we're inside spawn_blocking, not on the async runtime.
                    let Ok(app_state) = app_managed.lock() else {
                        log::error!("[READING] AppState lock poisoned");
                        return false;
                    };
                    let result = match &app_state.bible_db {
                        Some(db) => db.get_chapter(app_state.active_translation_id, recent.book_number, recent.chapter).ok(),
                        None => None,
                    };
                    log::info!("[READING] get_chapter took {:?}", t_db.elapsed());
                    result
                };

                if let Some(chapter_verses) = chapter_data {
                    let verses: Vec<(i32, String)> = chapter_verses
                        .into_iter()
                        .map(|v| (v.verse, v.text))
                        .collect();

                    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
                    if let Ok(mut rm) = rm_managed.lock() {
                        rm.start(
                            recent.book_number,
                            &recent.book_name,
                            recent.chapter,
                            recent.verse_start,
                            verses,
                        );

                        // Check if transcript contains "chapter" keyword - if so, expect chapter number next
                        // This handles "Genesis chapter" → pause → "5" → go to chapter 5
                        let lower = transcript.to_lowercase();
                        if lower.contains("chapter") && !lower.contains("next") && !lower.contains("previous") {
                            rm.set_expecting_chapter();
                        }
                    }
                }
            }
        }
    }

    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();

    // Check for chapter navigation commands (e.g., "let's go to chapter seven").
    {
        let chapter_change = {
            let Ok(mut rm) = rm_managed.lock() else { return false };
            if !rm.is_active() && !rm.has_verses() {
                None
            } else {
                log::info!("[READING] Checking chapter command for: {:?}", transcript);
                rm.check_chapter_command(transcript)
            }
        };

        if let Some(change) = chapter_change {
            let chapter_data = {
                let t_db = std::time::Instant::now();
                let app_managed: State<'_, Mutex<crate::state::AppState>> = app.state();
                // Blocking lock is OK — we're inside spawn_blocking, not on the async runtime.
                let Ok(app_state) = app_managed.lock() else {
                    log::error!("[READING] AppState lock poisoned (chapter nav)");
                    return false;
                };
                let result = match &app_state.bible_db {
                    Some(db) => db.get_chapter(
                        app_state.active_translation_id,
                        change.book_number,
                        change.new_chapter,
                    ).ok(),
                    None => None,
                };
                log::info!("[READING] get_chapter (nav) took {:?}", t_db.elapsed());
                result
            };

            if let Some(chapter_verses) = chapter_data {
                if !chapter_verses.is_empty() {
                    let start_verse = change.start_verse.unwrap_or(1);

                    // Find the text for the starting verse
                    let start_verse_text = chapter_verses
                        .iter()
                        .find(|v| v.verse == start_verse)
                        .map(|v| v.text.clone())
                        .unwrap_or_else(|| chapter_verses[0].text.clone());

                    let verses: Vec<(i32, String)> = chapter_verses
                        .into_iter()
                        .map(|v| (v.verse, v.text))
                        .collect();

                    if let Ok(mut rm) = rm_managed.lock() {
                        rm.start(
                            change.book_number,
                            &change.book_name,
                            change.new_chapter,
                            start_verse,
                            verses,
                        );
                    }

                    // Emit the starting verse of the new chapter
                    let reference = format!("{} {}:{}", change.book_name, change.new_chapter, start_verse);
                    let advance = rhema_detection::ReadingAdvance {
                        book_number: change.book_number,
                        book_name: change.book_name.clone(),
                        chapter: change.new_chapter,
                        verse: start_verse,
                        verse_text: start_verse_text.clone(),
                        reference: reference.clone(),
                        confidence: 1.0,
                    };
                    let _ = app.emit("reading_mode_verse", &advance);

                    return true;
                }
            }
        }
    }

    // Check reading mode for verse advancement.
    // Allow check even when paused (has_verses but !active) so "verse N"
    // commands can re-activate reading mode after timeout.
    let advance = {
        let Ok(mut rm) = rm_managed.lock() else { return false };
        if !rm.is_active() && !rm.has_verses() {
            return false;
        }
        rm.check_transcript(transcript)
    };

    if let Some(advance) = advance {
        let _ = app.emit("reading_mode_verse", &advance);
        return true;
    }

    false
}

/// Check for voice translation commands like "read in NIV", "switch to ESV".
fn check_translation_command(app: &AppHandle, transcript: &str) {
    #[derive(serde::Serialize, Clone)]
    struct TranslationSwitch {
        abbreviation: String,
        translation_id: i64,
    }

    let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
    let Ok(detector) = detector_state.lock() else { return };

    if let Some(abbrev) = detector.detect_translation_command(transcript) {
        drop(detector);

        // Find the translation ID for this abbreviation
        let managed: State<'_, Mutex<AppState>> = app.state();
        let Ok(mut app_state) = managed.try_lock() else { return };

        if let Some(ref db) = app_state.bible_db {
            if let Ok(translations) = db.list_translations() {
                if let Some(t) = translations.iter().find(|t| t.abbreviation == abbrev) {
                    app_state.active_translation_id = t.id;
                    log::info!("[STT] Voice command: switched to {abbrev} (id={})", t.id);
                    drop(app_state);

                    let _ = app.emit("translation_command", TranslationSwitch {
                        abbreviation: abbrev,
                        translation_id: t.id,
                    });
                }
            }
        }
    }
}

/// Stop the transcription pipeline (audio capture + STT provider).
#[tauri::command]
pub fn stop_transcription(
    state: State<'_, Mutex<AppState>>,
) -> Result<(), String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;

    if !app_state.stt_active.load(Ordering::Relaxed) {
        return Err("Transcription is not running".into());
    }

    // Setting these flags causes the background threads/tasks to exit.
    app_state.stt_active.store(false, Ordering::SeqCst);
    app_state.audio_active.store(false, Ordering::SeqCst);

    log::info!("Transcription stop requested");
    Ok(())
}

