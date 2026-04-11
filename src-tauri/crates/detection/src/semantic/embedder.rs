use crate::error::DetectionError;

/// Trait for embedding text into dense vectors.
///
/// Implementations may use ONNX Runtime, a remote API, or a stub
/// that returns zero vectors for development/testing.
pub trait TextEmbedder: Send + Sync {
    /// Embed the given text into a fixed-dimension vector.
    fn embed(&self, text: &str) -> Result<Vec<f32>, DetectionError>;

    /// Return the dimensionality of the embedding vectors.
    fn dimension(&self) -> usize;
}

/// Stub embedder that returns zero vectors.
///
/// Used when no real model is loaded so the application can still
/// compile and run without ONNX model files.
#[derive(Debug)]
pub struct StubEmbedder {
    dim: usize,
}

impl StubEmbedder {
    pub fn new(dim: usize) -> Self {
        Self { dim }
    }
}

impl TextEmbedder for StubEmbedder {
    fn embed(&self, _text: &str) -> Result<Vec<f32>, DetectionError> {
        Ok(vec![0.0; self.dim])
    }

    fn dimension(&self) -> usize {
        self.dim
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_embedder_dimension() {
        let embedder = StubEmbedder::new(1024);
        assert_eq!(embedder.dimension(), 1024);
    }

    #[test]
    fn test_stub_embedder_returns_zeros() {
        let embedder = StubEmbedder::new(128);
        let result = embedder.embed("hello world").unwrap();
        assert_eq!(result.len(), 128);
        assert!(result.iter().all(|&v| v == 0.0));
    }
}
