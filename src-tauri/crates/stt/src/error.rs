use thiserror::Error;

#[derive(Error, Debug)]
pub enum SttError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    #[error("API key is missing")]
    ApiKeyMissing,

    #[error("Local Whisper model is missing: {0}")]
    LocalModelMissing(String),

    #[error("Local Whisper model failed to load: {0}")]
    LocalModelLoadFailed(String),

    #[error("Send error: {0}")]
    SendError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Unsupported transcription backend: {0}")]
    UnsupportedBackend(String),
}
