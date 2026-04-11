use thiserror::Error;
use serde::Serialize;

#[derive(Error, Debug, Serialize)]
pub enum SttError {
    #[error("Transcription already running")]
    AlreadyRunning,
    #[error("Deepgram API key missing")]
    ApiKeyMissing,
    #[error("Failed to lock system state: {0}")]
    StateLockError(String),
    #[error("Audio capture failure: {0}")]
    AudioCaptureError(String),
    #[error("Deepgram connection failure: {0}")]
    ConnectionError(String),
    #[error("Transcription failed: {0}")]
    TranscriptionError(String),
    #[error("Thread spawn failure: {0}")]
    ThreadError(String),
}

impl From<rhema_core::CoreError> for SttError {
    fn from(e: rhema_core::CoreError) -> Self {
        Self::StateLockError(e.to_string())
    }
}
