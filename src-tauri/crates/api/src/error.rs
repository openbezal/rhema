use thiserror::Error;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("Unknown OSC address: {0}")]
    UnknownAddress(String),

    #[error("Missing argument for address: {address}")]
    MissingArgument { address: String },

    #[error("Type coercion failed: expected {expected}, got {got}")]
    TypeCoercion { expected: String, got: String },

    #[error("Dispatch failed: {0}")]
    DispatchFailed(String),

    #[error("Value out of range: {value} not in [{min}, {max}]")]
    OutOfRange { value: f32, min: f32, max: f32 },
}
