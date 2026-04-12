pub mod embedder;
pub mod index;
pub mod chunker;
pub mod cache;
pub mod detector;
pub mod synonyms;
pub mod ensemble;

#[cfg(feature = "onnx")]
pub mod onnx_embedder;

#[cfg(feature = "vector-search")]
pub mod hnsw_index;

#[cfg(feature = "onnx")]
pub mod precompute;
