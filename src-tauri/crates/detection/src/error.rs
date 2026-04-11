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
}
