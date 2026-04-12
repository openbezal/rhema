//! Real-time Bible verse detection for the Rhema application.
//!
//! Combines direct pattern matching and semantic vector search into a
//! unified pipeline that identifies Bible references in sermon transcripts.
//!
//! # Key types
//!
//! - [`DetectionPipeline`] — orchestrates all detection strategies
//! - [`DirectDetector`] — regex and Aho-Corasick pattern matching
//! - [`SemanticDetector`] — ONNX embedding and vector similarity search
//! - [`Detection`], [`VerseRef`] — detection results
//!
//! # Feature flags
//!
//! - `onnx` — enables ONNX Runtime for local embedding inference
//! - `vector-search` — enables HNSW vector index for similarity search

pub mod types;
pub mod error;
pub mod direct;
pub mod semantic;
pub mod merger;
pub mod pipeline;
pub mod sentence_buffer;
pub mod reading_mode;

pub use types::*;
pub use error::*;
pub use direct::detector::DirectDetector;
pub use semantic::detector::SemanticDetector;
pub use merger::{DetectionMerger, MergedDetection};
pub use pipeline::DetectionPipeline;
pub use sentence_buffer::SentenceBuffer;
pub use reading_mode::{ReadingMode, ReadingAdvance, ChapterChange};

#[cfg(feature = "onnx")]
pub use semantic::onnx_embedder::OnnxEmbedder;

#[cfg(feature = "vector-search")]
pub use semantic::hnsw_index::HnswVectorIndex;
