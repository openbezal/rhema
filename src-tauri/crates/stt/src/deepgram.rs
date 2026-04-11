use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crossbeam_channel::Receiver;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use url::Url;

use crate::error::SttError;
use crate::keyterms::bible_keyterms;
use crate::provider::SttProvider;
use crate::types::{SttConfig, TranscriptEvent, Word};

const MAX_RECONNECT_ATTEMPTS: u32 = 5;
const RECONNECT_DELAY: Duration = Duration::from_secs(1);
/// Batch up to 250ms of audio before sending (at 16kHz, that is 4000 samples).
const BATCH_SAMPLES: usize = 4000;

pub struct DeepgramClient {
    config: SttConfig,
    cancelled: Arc<AtomicBool>,
}

impl std::fmt::Debug for DeepgramClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeepgramClient")
            .field("model", &self.config.model)
            .finish_non_exhaustive()
    }
}

impl DeepgramClient {
    pub fn new(config: SttConfig) -> Self {
        Self {
            config,
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Build the Deepgram WebSocket URL with query parameters and keyword boosting.
    fn build_url(&self) -> Result<Url, SttError> {
        let mut url = Url::parse("wss://api.deepgram.com/v1/listen")
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        {
            let mut q = url.query_pairs_mut();
            q.append_pair("model", &self.config.model);
            q.append_pair("encoding", &self.config.encoding);
            q.append_pair("sample_rate", &self.config.sample_rate.to_string());
            q.append_pair("channels", "1");
            q.append_pair("punctuate", "true");
            q.append_pair("smart_format", "true");
            q.append_pair("interim_results", "true");
            q.append_pair("endpointing", "300");
            q.append_pair("utterance_end_ms", "1000");
            q.append_pair("vad_events", "true");

            if let Some(ref lang) = self.config.language {
                q.append_pair("language", lang);
            }

            // Deepgram Nova-3 keyword boosting: uses `keyterm` (not `keywords`).
            // Each keyterm is a separate query param. Max 100 per request.
            let core_terms = vec![
                "Jesus".to_string(),
                "Christ".to_string(),
                "God".to_string(),
                "Lord".to_string(),
                "Holy Spirit".to_string(),
            ];
            let bible_terms = bible_keyterms();

            // Deduplicate: core terms first, then bible_keyterms(), capped at 100.
            let mut seen = std::collections::HashSet::new();
            let mut all_keyterms: Vec<String> = Vec::new();
            for term in core_terms.into_iter().chain(bible_terms.into_iter()) {
                if seen.insert(term.clone()) {
                    all_keyterms.push(term);
                }
                if all_keyterms.len() >= 100 {
                    break;
                }
            }

            for term in &all_keyterms {
                q.append_pair("keyterm", term);
            }
            log::info!(
                "Deepgram keyterm boosting: {} keyterms added",
                all_keyterms.len()
            );
        }

        log::info!("Deepgram WebSocket URL: {}", url.as_str());
        Ok(url)
    }

    /// Connect to Deepgram and stream audio from `audio_rx`, emitting transcript events to `event_tx`.
    pub async fn connect(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        if self.config.api_key.is_empty() {
            return Err(SttError::ApiKeyMissing);
        }

        let cancelled = self.cancelled.clone();
        let mut attempts: u32 = 0;

        loop {
            if cancelled.load(Ordering::SeqCst) {
                log::info!("DeepgramClient: cancelled, stopping connection loop");
                break;
            }

            match self
                .try_connect(audio_rx.clone(), event_tx.clone(), cancelled.clone())
                .await
            {
                Ok(()) => {
                    // Clean shutdown
                    log::info!("DeepgramClient: connection closed normally");
                    break;
                }
                Err(e) => {
                    attempts += 1;
                    log::warn!(
                        "DeepgramClient: connection error (attempt {attempts}/{MAX_RECONNECT_ATTEMPTS}): {e}",
                    );

                    let _ = event_tx.send(TranscriptEvent::Disconnected).await;

                    if attempts >= MAX_RECONNECT_ATTEMPTS {
                        log::error!("DeepgramClient: max reconnection attempts reached");
                        let _ = event_tx
                            .send(TranscriptEvent::Error(format!(
                                "Max reconnection attempts reached: {e}"
                            )))
                            .await;
                        return Err(e);
                    }

                    tokio::time::sleep(RECONNECT_DELAY).await;
                }
            }
        }

        Ok(())
    }

    /// Attempt a single WebSocket connection and run send/receive loops.
    #[allow(clippy::too_many_lines)]
    async fn try_connect(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<(), SttError> {
        let url = self.build_url()?;

        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        let auth_value = format!("Token {}", self.config.api_key);
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&auth_value)
                .map_err(|e| SttError::ConnectionFailed(e.to_string()))?,
        );

        let (ws_stream, _response) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| SttError::ConnectionFailed(e.to_string()))?;

        log::info!("DeepgramClient: connected to Deepgram");
        let _ = event_tx.send(TranscriptEvent::Connected).await;

        let (mut write, mut read) = ws_stream.split();

        let send_cancelled = cancelled.clone();
        let recv_cancelled = cancelled.clone();

        // Track unexpected disconnects so try_connect returns Err and triggers reconnection.
        let send_error_flag = Arc::new(AtomicBool::new(false));
        let recv_error_flag = Arc::new(AtomicBool::new(false));
        let send_err = send_error_flag.clone();
        let recv_err = recv_error_flag.clone();

        // Split the sender into two parts to avoid blocking the tokio runtime:
        // 1. A blocking thread reads audio from crossbeam → sends to a tokio channel
        // 2. An async task reads from the tokio channel → writes to the WebSocket
        //
        // The blocking crossbeam recv_timeout() was starving the receiver/consumer
        // tasks when run inside tokio::spawn, causing events to stop flowing.

        // Bridge channel: blocking audio reader → async WebSocket writer
        #[allow(clippy::items_after_statements)]
        enum WsCommand {
            Audio(Vec<u8>),
            KeepAlive,
            Close,
        }
        let (ws_tx, mut ws_rx) = tokio::sync::mpsc::channel::<WsCommand>(64);

        // Part 1: Blocking thread reads audio from crossbeam channel
        let audio_reader = {
            let ws_tx = ws_tx.clone();
            let cancelled = send_cancelled.clone();
            tokio::task::spawn_blocking(move || {
                let mut batch_buf: Vec<u8> = Vec::with_capacity(BATCH_SAMPLES * 2);
                let batch_byte_threshold = BATCH_SAMPLES * 2;
                let mut last_send = std::time::Instant::now();
                let keepalive_interval = Duration::from_secs(5);

                loop {
                    if cancelled.load(Ordering::SeqCst) {
                        let _ = ws_tx.blocking_send(WsCommand::Close);
                        break;
                    }

                    match audio_rx.recv_timeout(Duration::from_millis(50)) {
                        Ok(samples) => {
                            for sample in &samples {
                                batch_buf.extend_from_slice(&sample.to_le_bytes());
                            }
                            if batch_buf.len() >= batch_byte_threshold {
                                let data = std::mem::take(&mut batch_buf);
                                if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                    break;
                                }
                                last_send = std::time::Instant::now();
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                            // Flush remaining audio
                            if !batch_buf.is_empty() {
                                let data = std::mem::take(&mut batch_buf);
                                if ws_tx.blocking_send(WsCommand::Audio(data)).is_err() {
                                    break;
                                }
                                last_send = std::time::Instant::now();
                            }
                            // KeepAlive if idle >5s
                            if last_send.elapsed() >= keepalive_interval {
                                if ws_tx.blocking_send(WsCommand::KeepAlive).is_err() {
                                    break;
                                }
                                last_send = std::time::Instant::now();
                            }
                        }
                        Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                            // Audio source closed
                            if !batch_buf.is_empty() {
                                let data = std::mem::take(&mut batch_buf);
                                let _ = ws_tx.blocking_send(WsCommand::Audio(data));
                            }
                            let _ = ws_tx.blocking_send(WsCommand::Close);
                            break;
                        }
                    }
                }
            })
        };

        // Part 2: Async task writes to WebSocket (non-blocking, doesn't starve tokio)
        let ws_writer = tokio::spawn(async move {
            while let Some(cmd) = ws_rx.recv().await {
                match cmd {
                    WsCommand::Audio(data) => {
                        if let Err(e) = write.send(Message::Binary(data.into())).await {
                            log::error!("DeepgramClient ws_writer: send error: {e}");
                            send_err.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    WsCommand::KeepAlive => {
                        let ka = serde_json::json!({"type": "KeepAlive"}).to_string();
                        if let Err(e) = write.send(Message::Text(ka.into())).await {
                            log::error!("DeepgramClient ws_writer: keepalive error: {e}");
                            send_err.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                    WsCommand::Close => {
                        let close_msg = serde_json::json!({"type": "CloseStream"}).to_string();
                        let _ = write.send(Message::Text(close_msg.into())).await;
                        let _ = write.close().await;
                        break;
                    }
                }
            }
        });

        // Receiver task: reads text frames and parses Deepgram JSON.
        let receiver = tokio::spawn(async move {
            while let Some(msg_result) = read.next().await {
                if recv_cancelled.load(Ordering::SeqCst) {
                    break;
                }

                match msg_result {
                    Ok(Message::Text(text)) => {
                        if let Err(e) = parse_and_send(&text, &event_tx).await {
                            log::warn!("DeepgramClient receiver: parse error: {e}");
                        }
                    }
                    Ok(Message::Close(_)) => {
                        log::info!("DeepgramClient receiver: server closed connection");
                        break;
                    }
                    Ok(_) => {
                        // Ignore binary/ping/pong frames
                    }
                    Err(e) => {
                        log::error!("DeepgramClient receiver: WebSocket error: {e}");
                        recv_err.store(true, Ordering::SeqCst);
                        let _ = event_tx
                            .send(TranscriptEvent::Error(format!("WebSocket error: {e}")))
                            .await;
                        break;
                    }
                }
            }
        });

        // Wait for all tasks
        let _ = tokio::join!(audio_reader, ws_writer, receiver);

        // If either side had an unexpected error, return Err so the connection loop retries.
        if send_error_flag.load(Ordering::SeqCst) || recv_error_flag.load(Ordering::SeqCst) {
            return Err(SttError::ConnectionFailed(
                "Connection lost unexpectedly".into(),
            ));
        }

        Ok(())
    }

    /// Cancel the current connection and signal shutdown.
    pub fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }
}

/// Parse a Deepgram JSON response and send the corresponding `TranscriptEvent`.
async fn parse_and_send(
    text: &str,
    event_tx: &mpsc::Sender<TranscriptEvent>,
) -> Result<(), SttError> {
    let json: serde_json::Value =
        serde_json::from_str(text).map_err(|e| SttError::ParseError(e.to_string()))?;

    // Deepgram may send different message types; we only handle "Results"
    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match msg_type {
        "UtteranceEnd" => {
            let _ = event_tx.send(TranscriptEvent::UtteranceEnd).await;
            return Ok(());
        }
        "SpeechStarted" => {
            let _ = event_tx.send(TranscriptEvent::SpeechStarted).await;
            return Ok(());
        }
        "Results" => { /* continue parsing below */ }
        _ => {
            // Metadata, etc. — ignore silently.
            return Ok(());
        }
    }

    let is_final = json
        .get("is_final")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let speech_final = json
        .get("speech_final")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);

    let channel = json.get("channel");
    let alternatives = channel
        .and_then(|c| c.get("alternatives"))
        .and_then(|a| a.as_array());

    let first_alt = alternatives.and_then(|arr| arr.first());

    let transcript = first_alt
        .and_then(|a| a.get("transcript"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let confidence = first_alt
        .and_then(|a| a.get("confidence"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);

    let words = first_alt
        .and_then(|a| a.get("words"))
        .and_then(|w| w.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|w| {
                    Some(Word {
                        text: w.get("word")?.as_str()?.to_string(),
                        start: w.get("start")?.as_f64()?,
                        end: w.get("end")?.as_f64()?,
                        confidence: w.get("confidence")?.as_f64()?,
                        punctuated_word: w
                            .get("punctuated_word")
                            .and_then(|p| p.as_str())
                            .map(ToString::to_string),
                    })
                })
                .collect::<Vec<Word>>()
        })
        .unwrap_or_default();

    let event = if is_final {
        TranscriptEvent::Final {
            transcript,
            words,
            confidence,
            speech_final,
        }
    } else {
        TranscriptEvent::Partial { transcript, words }
    };

    event_tx
        .send(event)
        .await
        .map_err(|e| SttError::SendError(e.to_string()))?;

    Ok(())
}

// ── SttProvider implementation ───────────────────────────────────────────────

#[async_trait::async_trait]
impl SttProvider for DeepgramClient {
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        let result = self.connect(audio_rx.clone(), event_tx.clone()).await;

        // On max reconnect failure, fall back to REST mode (hybrid).
        if let Err(ref e) = result {
            log::warn!(
                "[STT-Deepgram] WebSocket failed after retries: {e}, switching to REST fallback"
            );
            let _ = event_tx
                .send(TranscriptEvent::Error(
                    "Connection unstable, switching to Hybrid mode".into(),
                ))
                .await;

            let rest_client = crate::rest::DeepgramRestClient::new(self.config.clone());
            let mut audio_buffer: Vec<i16> = Vec::new();
            let flush_interval = std::time::Duration::from_secs(5);
            let mut last_flush = std::time::Instant::now();
            let cancelled = self.cancelled.clone();

            loop {
                if cancelled.load(Ordering::SeqCst) {
                    break;
                }

                match audio_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(samples) => {
                        audio_buffer.extend(samples);

                        if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
                            match rest_client.transcribe(&audio_buffer).await {
                                Ok(events) => {
                                    for evt in events {
                                        let _ = event_tx.send(evt).await;
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
                        if last_flush.elapsed() >= flush_interval && !audio_buffer.is_empty() {
                            match rest_client.transcribe(&audio_buffer).await {
                                Ok(events) => {
                                    for evt in events {
                                        let _ = event_tx.send(evt).await;
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

        Ok(())
    }

    fn stop(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    fn name(&self) -> &'static str {
        "deepgram"
    }
}
