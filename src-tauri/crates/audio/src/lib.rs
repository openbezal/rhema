//! Audio input capture for the Rhema application.
//!
//! Handles device enumeration, live audio capture via `cpal`, gain
//! control, mono 16-bit PCM conversion, and voice activity detection
//! (VAD) for speech segmentation.
//!
//! # Key types
//!
//! - [`AudioCapture`] — holds a live audio stream
//! - [`DeviceInfo`], [`AudioConfig`], [`AudioFrame`] — configuration and data
//! - [`AudioError`] — error type for audio operations

pub mod types;
pub mod error;
pub mod device;
pub mod meter;
pub mod capture;
pub mod vad;

pub use types::*;
pub use error::*;
pub use vad::{Vad, VadConfig, VadState, VadTransition};
