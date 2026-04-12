use thiserror::Error;

#[non_exhaustive]
#[derive(Error, Debug, Clone)]
pub enum SttError {
    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    #[error("API key is missing")]
    ApiKeyMissing,

    #[error("send error: {0}")]
    SendError(String),

    #[error("parse error: {0}")]
    ParseError(String),

    #[error("model not found: {0}")]
    ModelNotFound(String),
}
