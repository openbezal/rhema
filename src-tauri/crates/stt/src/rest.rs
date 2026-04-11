//! Deepgram REST API fallback for when WebSocket connection is unreliable.
//!
//! Buffers audio and periodically POSTs to the Deepgram REST endpoint.
//! Produces the same `TranscriptEvent` types as the WebSocket client.

use crate::error::SttError;
use crate::types::{SttConfig, TranscriptEvent, Word};

pub struct DeepgramRestClient {
    config: SttConfig,
    client: reqwest::Client,
}

impl DeepgramRestClient {
    pub fn new(config: SttConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    /// Transcribe a chunk of raw PCM audio (i16 LE samples, mono, 16kHz).
    ///
    /// Sends the audio to Deepgram's REST endpoint and returns transcript events.
    /// Unlike the WebSocket client, this is request/response — no streaming.
    pub async fn transcribe(&self, samples: &[i16]) -> Result<Vec<TranscriptEvent>, SttError> {
        if samples.is_empty() {
            return Ok(vec![]);
        }

        // Convert i16 samples to raw bytes (little-endian)
        let mut audio_bytes: Vec<u8> = Vec::with_capacity(samples.len() * 2);
        for sample in samples {
            audio_bytes.extend_from_slice(&sample.to_le_bytes());
        }

        let url = format!(
            "https://api.deepgram.com/v1/listen?model={}&encoding={}&sample_rate={}&channels=1&punctuate=true&smart_format=true",
            self.config.model,
            self.config.encoding,
            self.config.sample_rate,
        );

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Token {}", self.config.api_key))
            .header("Content-Type", "application/octet-stream")
            .body(audio_bytes)
            .send()
            .await
            .map_err(|e| SttError::ConnectionFailed(format!("REST request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SttError::ConnectionFailed(format!(
                "Deepgram REST API error {status}: {body}"
            )));
        }

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| SttError::ParseError(format!("Failed to parse REST response: {e}")))?;

        // Parse the REST response into TranscriptEvents.
        // REST response wraps everything in "results.channels[0].alternatives[0]"
        let mut events = Vec::new();

        let channels = json
            .get("results")
            .and_then(|r| r.get("channels"))
            .and_then(|c| c.as_array());

        if let Some(channels) = channels {
            for channel in channels {
                let alternatives = channel
                    .get("alternatives")
                    .and_then(|a| a.as_array());

                if let Some(alts) = alternatives {
                    if let Some(first) = alts.first() {
                        let transcript = first
                            .get("transcript")
                            .and_then(|t| t.as_str())
                            .unwrap_or("")
                            .to_string();

                        let confidence = first
                            .get("confidence")
                            .and_then(serde_json::Value::as_f64)
                            .unwrap_or(0.0);

                        let words = first
                            .get("words")
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

                        if !transcript.is_empty() {
                            events.push(TranscriptEvent::Final {
                                transcript,
                                words,
                                confidence,
                                speech_final: true,
                            });
                        }
                    }
                }
            }
        }

        Ok(events)
    }
}
