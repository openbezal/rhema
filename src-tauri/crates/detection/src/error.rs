use thiserror::Error;

#[non_exhaustive]
#[derive(Error, Debug, Clone)]
pub enum DetectionError {
    #[error("failed to parse reference: {0}")]
    ParseError(String),

    #[error("invalid book name: {0}")]
    InvalidBook(String),

    #[error("invalid chapter or verse number: {0}")]
    InvalidNumber(String),

    #[error("internal error: {0}")]
    Internal(String),

    #[error("Synchronization error: {0}")]
    Synchronization(#[from] rhema_core::CoreError),

    #[cfg(feature = "onnx")]
    #[error("ONNX Runtime error: {0}")]
    Onnx(#[from] ort::Error),

    #[cfg(feature = "onnx")]
    #[error("Tokenizer error: {0}")]
    Tokenizer(String),
}
