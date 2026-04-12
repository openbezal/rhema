use thiserror::Error;

#[non_exhaustive]
#[derive(Debug, Error)]
pub enum BibleError {
    #[error("database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid reference: {0}")]
    InvalidReference(String),

    #[error("internal error: {0}")]
    Internal(String),
}
