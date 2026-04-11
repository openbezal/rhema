use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::events::{
    AudioLevelPayload, TranscriptPayload, EVENT_AUDIO_LEVEL, EVENT_TRANSCRIPT_FINAL,
    EVENT_TRANSCRIPT_PARTIAL,
};
use crate::state::AppState;
pub mod errors;
pub mod direct;
pub mod semantic;
pub mod reading;
pub mod quotation;
pub mod command;

use errors::SttError;

/// Start the full audio-capture-to-transcription pipeline.
///
/// 1. Opens the microphone via cpal (on a dedicated thread so the non-Send
///    `AudioCapture` never crosses thread boundaries).
/// 2. Connects to Deepgram via WebSocket.
/// 3. Fans audio out to both the level meter (emits `audio_level` events) and Deepgram.
/// 4. Receives transcripts and emits `transcript_partial` / `transcript_final` events.
/// 5. On final transcripts, runs the detection pipeline and emits `verse_detected` events.
#[tauri::command]
pub async fn start_transcription(
    app: AppHandle,
    state: State<'_, Mutex<AppState>>,
    api_key: String,
    device_id: Option<String>,
    gain: Option<f32>,
) -> Result<(), SttError> {
    log::info ! ("[STT] Start request received");
    // ── 1. Guard: already running? ──────────────────────────────────────
    let (stt_active, audio_active) = {
        let app_state = state.lock().map_err(|e| SttError::StateLockError(e.to_string()))?;
        if app_state.stt_active.load(Ordering::Relaxed) {
            return Err(SttError::AlreadyRunning);
        }
        (app_state.stt_active.clone(), app_state.audio_active.clone())
    };

    // Resolve API key: use provided key, or fall back to DEEPGRAM_API_KEY env var
    let resolved_api_key = if api_key.is_empty() {
        std::env::var("DEEPGRAM_API_KEY").unwrap_or_default()
    } else {
        api_key
    };

    if resolved_api_key.is_empty() {
        return Err(SttError::ApiKeyMissing);
    }

    log::info!("Starting transcription: api_key={}..., device_id={:?}, gain={:?}",
        &resolved_api_key[..8.min(resolved_api_key.len())], device_id, gain);

    stt_active.store(true, Ordering::SeqCst);
    audio_active.store(true, Ordering::SeqCst);

    // ── 2. Prepare channels ─────────────────────────────────────────────
    // Deepgram channel carries Vec<i16> (the samples from each AudioFrame).
    let (deepgram_tx, deepgram_rx) = crossbeam_channel::bounded::<Vec<i16>>(64);

    // ── 3. Spawn the audio-capture + fan-out thread ─────────────────────
    // cpal's `Stream` (inside `AudioCapture`) is !Send, so we must create
    // and drop it on the same thread. This thread:
    //   a) starts the cpal capture
    //   b) reads AudioFrames
    //   c) computes levels → emits audio_level events
    //   d) forwards samples to Deepgram via crossbeam
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

            let (audio_tx, audio_rx) = crossbeam_channel::bounded::<AudioFrame>(64);

            // Start capture on THIS thread — AudioCapture stays here.
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

            loop {
                if !fan_active.load(Ordering::SeqCst) {
                    break;
                }

                match audio_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(frame) => {
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

                        // (b) Forward all audio to Deepgram
                        // NOTE: VAD module exists (audio/vad.rs) but disabled —
                        // Deepgram's built-in VAD handles silence detection.
                        // Re-enable when VAD thresholds are properly tuned.
                        let _ = deepgram_tx.try_send(frame.samples);
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                }
            }

            // Dropping `capture` stops the cpal stream.
            capture.stop();
            log::info!("Audio capture stopped on fanout thread");
        })
        .map_err(|e| {
            stt_active.store(false, Ordering::SeqCst);
            audio_active.store(false, Ordering::SeqCst);
            SttError::ThreadError(e.to_string())
        })?;

    // ── 4. Spawn the Deepgram connection on the tokio runtime ───────────
    let stt_config = SttConfig {
        api_key: resolved_api_key,
        model: "nova-3".to_string(),
        sample_rate: 16_000,
        encoding: "linear16".to_string(),
        language: None,
    };

    let client = DeepgramClient::new(stt_config.clone());

    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<TranscriptEvent>(64);

    let conn_active = stt_active.clone();
    let http_client = {
        let app_state = state.lock().map_err(|e| SttError::StateLockError(e.to_string()))?;
        app_state.http_client.clone()
    };

    // Task A: run the Deepgram WebSocket connection.
    // On max reconnect failure, falls back to REST mode (hybrid).
    let rest_event_tx = event_tx.clone();
    let rest_config = stt_config.clone();
    tauri::async_runtime::spawn(async move {
        let result = client.connect(deepgram_rx.clone(), event_tx).await;
        if let Err(e) = result {
            log::error!("Deepgram WebSocket failed: {e}");

            // ── Hybrid mode: fall back to REST transcription ──
            {
                log::warn!("[STT] Connection unstable, switching to Hybrid mode (REST fallback)");
                let _ = rest_event_tx
                    .send(TranscriptEvent::Error(
                        "Connection unstable, switching to Hybrid mode".into(),
                    ))
                    .await;

                let rest_client = rhema_stt::DeepgramRestClient::new(rest_config, http_client);
                let mut audio_buffer: Vec<i16> = Vec::new();
                let flush_interval = std::time::Duration::from_secs(5);
                let mut last_flush = std::time::Instant::now();

                loop {
                    if !conn_active.load(Ordering::SeqCst) {
                        break;
                    }

                    match deepgram_rx.recv_timeout(std::time::Duration::from_millis(100)) {
                        Ok(samples) => {
                            audio_buffer.extend(samples);

                            // Flush every 5 seconds of accumulated audio
                            if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
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
                            // Flush if we have audio and enough time has passed
                            if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
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
        }
        conn_active.store(false, Ordering::SeqCst);
        log::info!("Deepgram connection task exited");
    });

    // Task B: consume TranscriptEvents, emit to frontend, run detection
    let evt_active = stt_active.clone();
    let event_app = app.clone();

    // Background semantic detection channel — non-blocking, drops if busy
    let (semantic_tx, mut semantic_rx) = tokio::sync::mpsc::channel::<String>(4);

    // Spawn semantic detection worker
    let sem_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(text) = semantic_rx.recv().await {
            semantic::run(&sem_app, &text);
        }
    });

    // Background quotation matching channel
    let (quotation_tx, mut quotation_rx) = tokio::sync::mpsc::channel::<String>(8);

    let quot_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(text) = quotation_rx.recv().await {
            quotation::run(&quot_app, &text);
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

                        // Run direct detection on partials too
                        direct::run(&event_app, &transcript);
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
                        command::check_translation(&event_app, &transcript);

                        // Direct detection: instant (regex), runs on every is_final
                        let direct_found = direct::run(&event_app, &transcript);

                        // Reading mode: check if transcript matches expected verse
                        reading::check(&event_app, &transcript, direct_found);

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


/// Stop the transcription pipeline (audio capture + Deepgram).
#[tauri::command]
pub fn stop_transcription(
    state: State<'_, Mutex<AppState>>,
) -> Result<(), SttError> {
    log::info ! ("[STT] Stop request received");
    let app_state = state.lock().map_err(|e| SttError::StateLockError(e.to_string()))?;

    if !app_state.stt_active.load(Ordering::Relaxed) {
        return Ok(()); // Idempotent stop is better than error for reliability
    }

    // Setting these flags causes the background threads/tasks to exit.
    app_state.stt_active.store(false, Ordering::SeqCst);
    app_state.audio_active.store(false, Ordering::SeqCst);

    log::info!("Transcription stop requested");
    Ok(())
}
