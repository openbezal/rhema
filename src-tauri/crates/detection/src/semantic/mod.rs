pub mod embedder;
pub mod index;
pub mod detector;

#[cfg(feature = "onnx")]
pub mod onnx_embedder;

#[cfg(feature = "vector-search")]
pub mod hnsw_index;

#[cfg(feature = "onnx")]
pub mod precompute;
