//! STT provider trait abstraction.
//!
//! Allows swapping between Deepgram (cloud) and Whisper (local) backends
//! while keeping the same `TranscriptEvent` interface for the detection pipeline.

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;

use crate::error::SttError;
use crate::types::TranscriptEvent;

/// A speech-to-text provider that consumes audio and emits transcript events.
///
/// Both Deepgram (cloud) and Whisper (local) implement this trait so the
/// command layer can select a provider at runtime without changing the
/// downstream detection pipeline.
#[async_trait::async_trait]
pub trait SttProvider: Send + Sync {
    /// Start the provider, consuming raw 16 kHz mono i16 audio from `audio_rx`
    /// and emitting [`TranscriptEvent`]s to `event_tx`.
    ///
    /// Runs until cancelled, audio source disconnects, or an unrecoverable error.
    async fn start(
        &self,
        audio_rx: Receiver<Vec<i16>>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError>;

    /// Signal the provider to stop.
    fn stop(&self);

    /// Human-readable provider name for logging.
    fn name(&self) -> &'static str;
}
