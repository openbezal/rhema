use thiserror::Error;

#[non_exhaustive]
#[derive(Error, Debug, Clone)]
pub enum AudioError {
    #[error("device not found: {0}")]
    DeviceNotFound(String),

    #[error("no input devices available")]
    NoInputDevices,

    #[error("stream error: {0}")]
    StreamError(String),

    #[error("channel error: {0}")]
    ChannelError(String),
}
