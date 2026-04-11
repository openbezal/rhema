//! External API integrations for the Rhema application.
//!
//! Implements: OSC server, HTTP API (Axum).
//! Planned: `OpenAI` embeddings client.

pub mod coerce;
pub mod command;
pub mod dispatch;
pub mod error;
pub mod http;
pub mod osc;

pub use coerce::{coerce_bool, coerce_f32_normalized, coerce_string, parse_osc};
pub use command::RemoteCommand;
pub use dispatch::{CommandDispatcher, CommandSink};
pub use error::CommandError;
pub use http::{start_http_server, HttpConfig, HttpHandle, HttpStartResult, SharedStatus, StatusSnapshot, new_shared_status};
pub use osc::{start_osc_listener, OscConfig, OscHandle, OscStartResult};
