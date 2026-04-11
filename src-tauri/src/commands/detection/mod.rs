pub mod types;
pub mod mapper;
pub mod search;
pub mod status;
pub mod reading_mode;

// Re-export commands for easier registration in lib.rs
pub use search::{detect_verses, semantic_search, quotation_search};
pub use status::{detection_status, toggle_paraphrase_detection};
pub use reading_mode::{reading_mode_status, stop_reading_mode};
pub use types::*;
