use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::{
    AudioLevelPayload, TranscriptPayload, EVENT_AUDIO_LEVEL, EVENT_TRANSCRIPT_FINAL,
    EVENT_TRANSCRIPT_PARTIAL,
};
use crate::state::AppState;
use rhema_audio::{AudioConfig, AudioFrame};
use rhema_stt::local::{local_model_status, resolve_whisper_model};
use rhema_stt::{
    DeepgramClient, LocalWhisperClient, SttConfig, TranscriptEvent, TranscriptionBackend,
    TranscriptionStatus,
};

enum SelectedBackend {
    Local(LocalWhisperClient),
    Deepgram(DeepgramClient),
}

fn stt_base_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

#[tauri::command]
pub fn get_transcription_status() -> Result<TranscriptionStatus, String> {
    let base_dir = stt_base_dir();
    let local_model = local_model_status(&base_dir);
    let deepgram_key_configured = std::env::var("DEEPGRAM_API_KEY")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let recommended_backend = if local_model.exists {
        TranscriptionBackend::Local
    } else if deepgram_key_configured {
        TranscriptionBackend::Deepgram
    } else {
        TranscriptionBackend::Auto
    };

    Ok(TranscriptionStatus {
        backend: TranscriptionBackend::Auto,
        recommended_backend,
        local_model,
        deepgram_key_configured,
    })
}

/// Start the full audio-capture-to-transcription pipeline.
///
/// 1. Opens the microphone via cpal (on a dedicated thread so the non-Send
///    `AudioCapture` never crosses thread boundaries).
/// 2. Resolves the transcription backend (local whisper.cpp by default, Deepgram fallback).
/// 3. Fans audio out to the level meter (emits `audio_level` events) and the chosen backend.
/// 4. Receives transcripts and emits `transcript_partial` / `transcript_final` events.
/// 5. On final transcripts, runs the detection pipeline and emits `verse_detected` events.
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    api_key: Option<String>,
    device_id: Option<String>,
    gain: Option<f32>,
    backend: Option<String>,
) -> Result<(), String> {
    // ── 1. Guard: already running? ──────────────────────────────────────
    let (stt_active, audio_active) = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        if app_state.stt_active.load(Ordering::Relaxed) {
            return Err("Transcription is already running".into());
        }
        (app_state.stt_active.clone(), app_state.audio_active.clone())
    };

    let backend_mode = TranscriptionBackend::from_option(backend.as_deref());
    let resolved_api_key = api_key
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("DEEPGRAM_API_KEY").ok())
        .unwrap_or_default();

    let base_dir = stt_base_dir();
    let local_status = local_model_status(&base_dir);
    let local_model_path = resolve_whisper_model(&base_dir);

    let stt_config = SttConfig {
        api_key: resolved_api_key,
        model: "nova-3".to_string(),
        sample_rate: 16_000,
        encoding: "linear16".to_string(),
        language: None,
    };

    let selected_backend = match backend_mode {
        TranscriptionBackend::Local => {
            let model_path = local_model_path
                .clone()
                .ok_or_else(|| local_status.note.clone())?;
            let client = LocalWhisperClient::new(model_path)
                .map_err(|e| format!("Local Whisper setup failed: {e}"))?;
            SelectedBackend::Local(client)
        }
        TranscriptionBackend::Deepgram => {
            if stt_config.api_key.is_empty() {
                return Err(
                    "No Deepgram API key provided. Set it in Settings or via DEEPGRAM_API_KEY env var."
                        .into(),
                );
            }
            SelectedBackend::Deepgram(DeepgramClient::new(stt_config.clone()))
        }
        TranscriptionBackend::Auto => {
            if let Some(model_path) = local_model_path.clone() {
                match LocalWhisperClient::new(model_path) {
                    Ok(client) => SelectedBackend::Local(client),
                    Err(err) => {
                        if !stt_config.api_key.is_empty() {
                            log::warn!(
                                "Local Whisper unavailable, falling back to Deepgram: {err}"
                            );
                            SelectedBackend::Deepgram(DeepgramClient::new(stt_config.clone()))
                        } else {
                            return Err(format!(
                                "Local Whisper is not ready and no Deepgram key is configured: {err}"
                            ));
                        }
                    }
                }
            } else if !stt_config.api_key.is_empty() {
                log::warn!(
                    "Local Whisper model missing, falling back to Deepgram: {}",
                    local_status.note
                );
                SelectedBackend::Deepgram(DeepgramClient::new(stt_config.clone()))
            } else {
                return Err(local_status.note.clone());
            }
        }
    };

    log::info!(
        "Starting transcription: backend={}, device_id={:?}, gain={:?}",
        backend_mode.as_str(),
        device_id,
        gain
    );

    stt_active.store(true, Ordering::SeqCst);
    audio_active.store(true, Ordering::SeqCst);

    // ── 2. Prepare channels ─────────────────────────────────────────────
    let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);
    let (backend_audio_tx, backend_audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);

    // ── 3. Spawn the audio-capture + fan-out thread ─────────────────────
    // cpal's `Stream` (inside `AudioCapture`) is !Send, so we must create
    // and drop it on the same thread. This thread:
    //   a) starts the cpal capture
    //   b) reads AudioFrames
    //   c) computes levels → emits audio_level events
    //   d) forwards frames to the chosen transcription backend
    let gain_val = gain.unwrap_or(1.0).clamp(0.0, 2.0);
    let fan_active = stt_active.clone();
    let fan_app = app.clone();

    std::thread::Builder::new()
        .name("audio-fanout".into())
        .spawn(move || {
            let config = AudioConfig {
                device_id,
                sample_rate: 16_000,
                gain: gain_val,
            };

            let capture = match rhema_audio::capture::start(config, audio_tx) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to start audio capture: {e}");
                    fan_active.store(false, Ordering::SeqCst);
                    return;
                }
            };

            log::info!("Audio capture started on fanout thread");

            let mut frame_count: u64 = 0;

            while fan_active.load(Ordering::SeqCst) {
                match audio_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(frame) => {
                        frame_count += 1;

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

                        if backend_audio_tx.send(frame).is_err() {
                            log::warn!("Backend audio channel disconnected; stopping capture");
                            break;
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                }
            }

            capture.stop();
            log::info!("Audio capture stopped on fanout thread");
        })
        .map_err(|e| {
            stt_active.store(false, Ordering::SeqCst);
            audio_active.store(false, Ordering::SeqCst);
            format!("Failed to spawn audio fanout thread: {e}")
        })?;

    // ── 4. Spawn the selected transcription backend on the tokio runtime ─
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);

    let conn_active = stt_active.clone();
    let audio_active_task = audio_active.clone();
    let backend_audio_rx = backend_audio_rx;

    match selected_backend {
        SelectedBackend::Local(client) => {
            let conn_active = conn_active.clone();
            let audio_active_task = audio_active_task.clone();
            let task_event_tx = event_tx.clone();
            let local_audio_rx = backend_audio_rx.clone();
            tauri::async_runtime::spawn(async move {
                let result = client.connect(local_audio_rx, task_event_tx.clone()).await;
                if let Err(e) = result {
                    log::error!("Local Whisper backend failed: {e}");
                    let _ = task_event_tx
                        .send(TranscriptEvent::Error(format!(
                            "Local Whisper backend failed: {e}"
                        )))
                        .await;
                }
                conn_active.store(false, Ordering::SeqCst);
                audio_active_task.store(false, Ordering::SeqCst);
                log::info!("Local Whisper transcription task exited");
            });
        }
        SelectedBackend::Deepgram(client) => {
            let deepgram_audio_rx = backend_audio_rx.clone();
            let rest_audio_rx = backend_audio_rx;
            let rest_event_tx = event_tx.clone();
            let rest_config = stt_config.clone();
            let task_event_tx = event_tx.clone();
            tauri::async_runtime::spawn(async move {
                let result = client.connect(deepgram_audio_rx, task_event_tx).await;
                if let Err(e) = result {
                    log::error!("Deepgram WebSocket failed: {e}");

                    log::warn!(
                        "[STT] Connection unstable, switching to Hybrid mode (REST fallback)"
                    );
                    let _ = rest_event_tx
                        .send(TranscriptEvent::Error(
                            "Connection unstable, switching to Hybrid mode".into(),
                        ))
                        .await;

                    let rest_client = rhema_stt::DeepgramRestClient::new(rest_config);
                    let mut audio_buffer: Vec<i16> = Vec::new();
                    let flush_interval = std::time::Duration::from_secs(5);
                    let mut last_flush = std::time::Instant::now();

                    loop {
                        if !conn_active.load(Ordering::SeqCst) {
                            break;
                        }

                        match rest_audio_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                            Ok(frame) => {
                                audio_buffer.extend(frame.samples);

                                if last_flush.elapsed() >= flush_interval
                                    && !audio_buffer.is_empty()
                                {
                                    match rest_client.transcribe(&audio_buffer).await {
                                        Ok(events) => {
                                            for evt in events {
                                                let _ = rest_event_tx.send(evt).await;
                                            }
                                        }
                                        Err(e) => {
                                            log::error!("[STT-REST] Transcription failed: {e}");
                                        }
                                    }
                                    audio_buffer.clear();
                                    last_flush = std::time::Instant::now();
                                }
                            }
                            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                                if last_flush.elapsed() >= flush_interval
                                    && !audio_buffer.is_empty()
                                {
                                    match rest_client.transcribe(&audio_buffer).await {
                                        Ok(events) => {
                                            for evt in events {
                                                let _ = rest_event_tx.send(evt).await;
                                            }
                                        }
                                        Err(e) => {
                                            log::error!("[STT-REST] Transcription failed: {e}");
                                        }
                                    }
                                    audio_buffer.clear();
                                    last_flush = std::time::Instant::now();
                                }
                            }
                            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                        }
                    }
                }
                conn_active.store(false, Ordering::SeqCst);
                audio_active_task.store(false, Ordering::SeqCst);
                log::info!("Deepgram connection task exited");
            });
        }
    }

    // Task B: consume TranscriptEvents, emit to frontend, run detection
    let evt_active = stt_active.clone();
    let event_app = app.clone();

    // Background semantic detection channel — non-blocking, drops if busy
    let (semantic_tx, mut semantic_rx) = tokio::sync::mpsc::channel::<String>(4);

    // Spawn semantic detection worker (runs ONNX inference without blocking transcript)
    let sem_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(text) = semantic_rx.recv().await {
            run_semantic_detection(&sem_app, &text);
        }
    });

    // Background quotation matching channel — fast but separate thread
    let (quotation_tx, mut quotation_rx) = tokio::sync::mpsc::channel::<String>(8);

    let quot_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(text) = quotation_rx.recv().await {
            run_quotation_matching(&quot_app, &text);
        }
    });

    tauri::async_runtime::spawn(async move {
        // Sentence buffer accumulates is_final fragments into complete sentences.
        // Flushes on sentence-ending punctuation or speech_final signal.
        let mut sentence_buf = rhema_detection::SentenceBuffer::new();

        while let Some(event) = event_rx.recv().await {
            if !evt_active.load(Ordering::SeqCst) {
                break;
            }

            match event {
                TranscriptEvent::Partial { transcript, .. } => {
                    if !transcript.is_empty() {
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_PARTIAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: false,
                                confidence: 0.0,
                            },
                        );

                        // Run direct detection on partials too — cheap regex
                        // patterns make this feasible on every interim result.
                        // This makes detection feel instant for verbose forms
                        // like "Psalm chapter 2 verse 3" that take longer to
                        // finalize than compact "Psalm 2:3".
                        run_direct_detection(&event_app, &transcript);
                    }
                }
                TranscriptEvent::Final {
                    transcript,
                    confidence,
                    speech_final,
                    ..
                } => {
                    if !transcript.is_empty() {
                        // Emit as permanent transcript segment (every is_final)
                        let _ = event_app.emit(
                            EVENT_TRANSCRIPT_FINAL,
                            TranscriptPayload {
                                text: transcript.clone(),
                                is_final: true,
                                confidence,
                            },
                        );

                        // Check for translation commands: "read in NIV", "switch to ESV"
                        check_translation_command(&event_app, &transcript);

                        // Direct detection: instant (regex), runs on every is_final
                        let direct_found = run_direct_detection(&event_app, &transcript);

                        // Reading mode: check if transcript matches expected verse
                        check_reading_mode(&event_app, &transcript, direct_found);

                        // Quotation matching: run on every is_final (fast, no ONNX)
                        if !direct_found {
                            let _ = quotation_tx.try_send(transcript.clone());
                        }

                        // Only accumulate for semantic if direct didn't find
                        // high-confidence results. No point running ONNX inference
                        // on "Revelation chapter two verse three" when direct
                        // already detected it at 100%.
                        if !direct_found {
                            if let Some(sentence) = sentence_buf.append(&transcript) {
                                let _ = semantic_tx.try_send(sentence);
                            }
                        } else {
                            // Clear the sentence buffer — direct handled it
                            sentence_buf.force_flush();
                        }
                    }

                    // On speech_final: force-flush any remaining buffered text
                    if speech_final {
                        if let Some(sentence) = sentence_buf.force_flush() {
                            let _ = semantic_tx.try_send(sentence);
                        }
                    }
                }
                TranscriptEvent::UtteranceEnd => {
                    // Fallback: flush sentence buffer on utterance end
                    if let Some(sentence) = sentence_buf.force_flush() {
                        let _ = semantic_tx.try_send(sentence);
                    }
                }
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
fn run_direct_detection(app: &AppHandle, transcript: &str) -> bool {
    use rhema_detection::{DetectionMerger, DirectDetector};

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
    let mut app_state = match app_managed.try_lock() {
        Ok(s) => s,
        Err(_) => {
            // AppState locked by semantic worker — emit results without verse text
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
                    }
                })
                .collect();
            for r in &results {
                log::info!(
                    "[DET-DIRECT] Found: {} ({:.0}%) (no DB)",
                    r.verse_ref,
                    r.confidence * 100.0
                );
            }
            let _ = app.emit("verse_detections", &results);
            return has_high_confidence;
        }
    };
    let results: Vec<super::detection::DetectionResult> = merged
        .iter()
        .map(|m| super::detection::to_result(&app_state, m))
        .collect();

    // Update sermon context with direct detection results
    for m in &merged {
        app_state
            .sermon_context
            .update(&m.detection.verse_ref, m.detection.confidence, "direct");
    }

    for r in &results {
        log::info!(
            "[DET-DIRECT] Found: {} ({:.0}%)",
            r.verse_ref,
            r.confidence * 100.0
        );
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
    has_high_confidence
}

/// Run semantic (ONNX embedding) detection. Slow, runs in background worker.
fn run_semantic_detection(app: &AppHandle, transcript: &str) {
    log::info!(
        "[DET-SEMANTIC] Running on: {:?}",
        &transcript[..transcript.len().min(80)]
    );
    let managed: State<'_, Mutex<AppState>> = app.state();
    let mut app_state = match managed.lock() {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to lock AppState for semantic detection: {e}");
            return;
        }
    };
    let mut detections = app_state.detection_pipeline.process_semantic(transcript);
    if detections.is_empty() {
        log::info!("[DET-SEMANTIC] No detections");
        return;
    }

    // Apply context boosting: same-book/chapter detections get higher confidence
    for m in &mut detections {
        let boost = app_state.sermon_context.confidence_boost(
            m.detection.verse_ref.book_number,
            m.detection.verse_ref.chapter,
        );
        if boost > 0.0 {
            m.detection.confidence = (m.detection.confidence + boost).min(1.0);
        }
    }

    // Update sermon context with the top detection
    if let Some(top) = detections.first() {
        app_state.sermon_context.update(
            &top.detection.verse_ref,
            top.detection.confidence,
            "semantic",
        );
    }

    let results: Vec<super::detection::DetectionResult> = detections
        .iter()
        .map(|m| super::detection::to_result(&app_state, m))
        .collect();
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
    let _ = app.emit("verse_detections", &results);
}

/// Check reading mode: if active, test transcript against expected verse.
/// If direct detection just found a new verse, start/restart reading mode.
fn check_reading_mode(app: &AppHandle, transcript: &str, direct_found: bool) {
    use rhema_detection::ReadingMode;

    // If direct detection found a verse, consider starting/restarting reading mode.
    // BUT: if reading mode is already active on a book/chapter, do NOT restart
    // on a different book — false positives from bare numbers (e.g., "verse 5"
    // getting matched as "Job 3:5") would hijack the reading session.
    if direct_found {
        let verse_info = {
            let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
            let detector = match detector_state.lock() {
                Ok(d) => d,
                Err(_) => return,
            };
            detector.recent_detections.front().cloned()
        };

        if let Some(recent) = verse_info {
            // Get the confidence of the detection to distinguish explicit refs from false positives
            let detection_confidence = {
                let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
                detector_state
                    .lock()
                    .ok()
                    .and_then(|d| d.recent_detections.front().map(|_| 0.95)) // Direct detections are always high confidence
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
                            && rm.current_chapter() == recent.chapter
                        {
                            false // Same book+chapter — already tracking this
                        } else if rm.current_book() != recent.book_number
                            && detection_confidence >= 0.90
                        {
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
                    let app_managed: State<'_, Mutex<crate::state::AppState>> = app.state();
                    let app_state = match app_managed.try_lock() {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    match &app_state.bible_db {
                        Some(db) => db
                            .get_chapter(
                                app_state.active_translation_id,
                                recent.book_number,
                                recent.chapter,
                            )
                            .ok(),
                        None => None,
                    }
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
                    }
                }
            }
        }
    }

    // Check reading mode for verse advancement
    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
    let advance = {
        let mut rm = match rm_managed.lock() {
            Ok(rm) => rm,
            Err(_) => return,
        };
        if !rm.is_active() {
            return;
        }
        rm.check_transcript(transcript)
    };

    if let Some(advance) = advance {
        let _ = app.emit("reading_mode_verse", &advance);

        // Also emit as a verse_detection so it appears in the detections panel
        let result = super::detection::DetectionResult {
            verse_ref: advance.reference.clone(),
            verse_text: advance.verse_text.clone(),
            book_name: advance.book_name.clone(),
            book_number: advance.book_number,
            chapter: advance.chapter,
            verse: advance.verse,
            confidence: advance.confidence,
            source: "contextual".to_string(),
            auto_queued: true,
            transcript_snippet: String::new(),
        };
        let _ = app.emit("verse_detections", &vec![result]);
    }
}

/// Check for voice translation commands like "read in NIV", "switch to ESV".
fn check_translation_command(app: &AppHandle, transcript: &str) {
    let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
    let detector = match detector_state.lock() {
        Ok(d) => d,
        Err(_) => return,
    };

    if let Some(abbrev) = detector.detect_translation_command(transcript) {
        drop(detector);

        // Find the translation ID for this abbreviation
        let managed: State<'_, Mutex<AppState>> = app.state();
        let mut app_state = match managed.try_lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        if let Some(ref db) = app_state.bible_db {
            if let Ok(translations) = db.list_translations() {
                if let Some(t) = translations.iter().find(|t| t.abbreviation == abbrev) {
                    app_state.active_translation_id = t.id;
                    log::info!("[STT] Voice command: switched to {} (id={})", abbrev, t.id);
                    drop(app_state);

                    // Emit event so frontend updates
                    #[derive(serde::Serialize, Clone)]
                    struct TranslationSwitch {
                        abbreviation: String,
                        translation_id: i64,
                    }
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

/// Run quotation matching against all loaded Bible translations.
fn run_quotation_matching(app: &AppHandle, transcript: &str) {
    // When reading mode is active, suppress quotation matching entirely.
    // The reader is actively reading a passage — quotation matches for
    // OTHER books would hijack the display away from what's being read.
    {
        use rhema_detection::ReadingMode;
        let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
        if let Ok(rm) = rm_managed.lock() {
            if rm.is_active() || rm.has_verses() {
                return; // Reading mode owns the display
            }
        }
    }

    let managed: State<'_, Mutex<AppState>> = app.state();
    let app_state = match managed.try_lock() {
        Ok(s) => s,
        Err(_) => return, // AppState busy
    };

    if !app_state.quotation_matcher.is_ready() {
        return;
    }

    let detections = app_state.quotation_matcher.match_transcript(transcript);
    if detections.is_empty() {
        return;
    }

    let results: Vec<super::detection::DetectionResult> = detections
        .iter()
        .map(|d| {
            let vr = &d.verse_ref;
            // Try to resolve verse text from DB
            let verse_text = if let Some(ref db) = app_state.bible_db {
                db.get_verse(
                    app_state.active_translation_id,
                    vr.book_number,
                    vr.chapter,
                    vr.verse_start,
                )
                .ok()
                .flatten()
                .map(|v| v.text)
                .unwrap_or_default()
            } else {
                String::new()
            };

            super::detection::DetectionResult {
                verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
                verse_text,
                book_name: vr.book_name.clone(),
                book_number: vr.book_number,
                chapter: vr.chapter,
                verse: vr.verse_start,
                confidence: d.confidence,
                source: "quotation".to_string(),
                auto_queued: d.confidence >= 0.85,
                transcript_snippet: d.transcript_snippet.clone(),
            }
        })
        .collect();

    for r in &results {
        log::info!(
            "[DET-QUOTATION] Found: {} ({:.0}%) auto_q={}",
            r.verse_ref,
            r.confidence * 100.0,
            r.auto_queued
        );
    }

    drop(app_state);
    let _ = app.emit("verse_detections", &results);
}

/// Stop the transcription pipeline (audio capture + Deepgram).
#[tauri::command]
pub fn stop_transcription(state: State<'_, Mutex<AppState>>) -> Result<(), String> {
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
