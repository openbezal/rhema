//! Speech-to-text integration for the Rhema application.
//!
//! Provides real-time transcription via the Deepgram WebSocket API,
//! with support for keyword boosting (Bible terms), reconnection
//! logic, and configurable models.
//!
//! # Key types
//!
//! - [`DeepgramClient`] — WebSocket client for live transcription
//! - [`TranscriptEvent`] — streaming transcript events (partial, final, etc.)
//! - [`SttConfig`] — API configuration
//! - [`SttError`] — error type for STT operations
//!
//! # Feature flags
//!
//! - `rest-fallback` — enables REST API fallback client

pub mod deepgram;
pub mod error;
pub mod rest;
pub mod types;

pub use deepgram::DeepgramClient;
pub use error::SttError;
pub use types::{SttConfig, TranscriptEvent, Word};

pub use rest::DeepgramRestClient;
