use crate::error::DetectionError;

/// A single search result from the vector index.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchResult {
    /// The database row-id (or ordinal) that identifies the verse.
    pub verse_id: i64,
    /// Cosine similarity (or other metric) between the query and the
    /// stored verse embedding. Higher is better.
    pub similarity: f64,
}

/// Trait for vector similarity search over pre-computed verse embeddings.
///
/// Implementations may use HNSW, brute-force, or a remote service.
pub trait VectorIndex: Send + Sync {
    /// Return the `k` nearest neighbours for the given query vector.
    fn search(&self, query: &[f32], k: usize) -> Result<Vec<SearchResult>, DetectionError>;

    /// Total number of vectors stored in the index.
    fn len(&self) -> usize;

    /// Whether the index contains no vectors.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Stub index that always returns empty results.
///
/// Used when no pre-computed vector index is available.
#[derive(Debug)]
pub struct StubIndex;

impl VectorIndex for StubIndex {
    fn search(&self, _query: &[f32], _k: usize) -> Result<Vec<SearchResult>, DetectionError> {
        Ok(vec![])
    }

    fn len(&self) -> usize {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stub_index_is_empty() {
        let index = StubIndex;
        assert!(index.is_empty());
        assert_eq!(index.len(), 0);
    }

    #[test]
    fn test_stub_index_returns_empty() {
        let index = StubIndex;
        let results = index.search(&[0.0; 128], 5).unwrap();
        assert!(results.is_empty());
    }
}
