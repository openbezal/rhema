//! NDI video broadcasting for the Rhema application.
//!
//! Provides runtime-loaded NDI SDK integration for sending video
//! frames over the network. Supports multiple concurrent sessions
//! with configurable resolution, frame rate, and alpha mode.
//!
//! # Key types
//!
//! - [`ndi::NdiRuntime`] — manages NDI send sessions
//! - [`ndi::NdiStartRequest`] — session configuration
//! - [`ndi::NdiError`] — error type for NDI operations

pub mod ndi;
