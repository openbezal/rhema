pub mod backend;
pub mod deepgram;
pub mod error;
pub mod keyterms;
pub mod local;
pub mod rest;
pub mod types;

pub use backend::{LocalModelStatus, TranscriptionStatus};
pub use deepgram::DeepgramClient;
pub use error::SttError;
pub use keyterms::bible_keyterms;
pub use local::LocalWhisperClient;
pub use types::{SttConfig, TranscriptEvent, TranscriptionBackend, Word};

pub use rest::DeepgramRestClient;
