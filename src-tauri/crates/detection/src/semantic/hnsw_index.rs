//! Brute-force cosine-similarity vector index.
//!
//! At ~31 K verses x 1024 dims the brute-force scan takes only a few
//! milliseconds on modern hardware, so there is no need for approximate
//! nearest-neighbour structures yet.
//!
//! This module is only compiled when the `vector-search` feature is enabled.

#[cfg(feature = "vector-search")]
use std::path::Path;

#[cfg(feature = "vector-search")]
use crate::error::DetectionError;
#[cfg(feature = "vector-search")]
use super::index::{SearchResult, VectorIndex};

/// Vector index backed by a flat array of pre-computed embeddings.
///
/// Search is exhaustive (brute-force dot product).  Because all stored
/// vectors and query vectors are L2-normalised, the dot product equals
/// cosine similarity.
#[cfg(feature = "vector-search")]
pub struct HnswVectorIndex {
    /// Flattened embedding matrix: `embeddings[i * dim .. (i+1) * dim]`
    /// is the vector for verse `verse_ids[i]`.
    embeddings: Vec<f32>,
    /// Verse (or row) identifiers, one per stored vector.
    verse_ids: Vec<i64>,
    /// Dimensionality of each embedding vector.
    dimension: usize,
}

#[cfg(feature = "vector-search")]
impl HnswVectorIndex {
    /// Load pre-computed embeddings and their verse IDs from binary files.
    ///
    /// **Embeddings file** — a sequence of `f32` values in native byte
    /// order.  Each consecutive `dim` floats form one vector.
    ///
    /// **IDs file** — a sequence of `i64` values in native byte order,
    /// one per vector.
    pub fn load(
        embeddings_path: &Path,
        ids_path: &Path,
        dim: usize,
    ) -> Result<Self, DetectionError> {
        // --- Read embeddings ---
        let emb_bytes = std::fs::read(embeddings_path).map_err(|e| {
            DetectionError::Internal(format!(
                "read embeddings {}: {e}",
                embeddings_path.display()
            ))
        })?;

        if emb_bytes.len() % std::mem::size_of::<f32>() != 0 {
            return Err(DetectionError::Internal(
                "embeddings file size is not a multiple of 4".into(),
            ));
        }

        let embeddings: Vec<f32> = bytemuck::cast_slice(&emb_bytes).to_vec();
        let num_vectors = embeddings.len() / dim;

        if !embeddings.len().is_multiple_of(dim) {
            return Err(DetectionError::Internal(format!(
                "embeddings length {} is not a multiple of dim {}",
                embeddings.len(),
                dim
            )));
        }

        // --- Read IDs ---
        let ids_bytes = std::fs::read(ids_path).map_err(|e| {
            DetectionError::Internal(format!("read ids {}: {e}", ids_path.display()))
        })?;

        if ids_bytes.len() % std::mem::size_of::<i64>() != 0 {
            return Err(DetectionError::Internal(
                "ids file size is not a multiple of 8".into(),
            ));
        }

        let verse_ids: Vec<i64> = bytemuck::cast_slice(&ids_bytes).to_vec();

        if verse_ids.len() != num_vectors {
            return Err(DetectionError::Internal(format!(
                "vector count mismatch: {} embeddings vs {} ids",
                num_vectors,
                verse_ids.len()
            )));
        }

        log::info!(
            "HnswVectorIndex loaded: {num_vectors} vectors, dim={dim}",
        );

        Ok(Self {
            embeddings,
            verse_ids,
            dimension: dim,
        })
    }

    /// Build an index directly from in-memory data.
    ///
    /// Useful for tests or when embeddings have just been computed.
    pub fn from_vecs(
        embeddings: Vec<Vec<f32>>,
        verse_ids: Vec<i64>,
        dim: usize,
    ) -> Result<Self, DetectionError> {
        if embeddings.len() != verse_ids.len() {
            return Err(DetectionError::Internal(
                "embeddings and verse_ids length mismatch".into(),
            ));
        }

        let flat: Vec<f32> = embeddings.into_iter().flatten().collect();

        Ok(Self {
            embeddings: flat,
            verse_ids,
            dimension: dim,
        })
    }
}

#[cfg(feature = "vector-search")]
impl VectorIndex for HnswVectorIndex {
    fn search(&self, query: &[f32], k: usize) -> Result<Vec<SearchResult>, DetectionError> {
        if query.len() != self.dimension {
            return Err(DetectionError::Internal(format!(
                "query dim {} != index dim {}",
                query.len(),
                self.dimension
            )));
        }

        let n = self.verse_ids.len();
        if n == 0 {
            return Ok(vec![]);
        }

        // Compute dot product (= cosine similarity for L2-normalised vectors)
        // with every stored vector and keep the top k.
        let mut scores: Vec<(usize, f64)> = Vec::with_capacity(n);

        for i in 0..n {
            let start = i * self.dimension;
            let end = start + self.dimension;
            let stored = &self.embeddings[start..end];

            let dot: f32 = query
                .iter()
                .zip(stored.iter())
                .map(|(a, b)| a * b)
                .sum();

            scores.push((i, f64::from(dot)));
        }

        // Partial sort: we only need the top-k, but for 31K entries a full
        // sort is perfectly fine (~0.1 ms).
        scores.sort_unstable_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let results: Vec<SearchResult> = scores
            .into_iter()
            .take(k)
            .map(|(idx, sim)| SearchResult {
                verse_id: self.verse_ids[idx],
                similarity: sim,
            })
            .collect();

        Ok(results)
    }

    fn len(&self) -> usize {
        self.verse_ids.len()
    }
}

#[cfg(all(test, feature = "vector-search"))]
mod tests {
    use super::*;

    fn make_unit_vec(dim: usize, hot: usize) -> Vec<f32> {
        let mut v = vec![0.0f32; dim];
        v[hot] = 1.0;
        v
    }

    #[test]
    fn test_brute_force_search() {
        let dim = 4;
        let embeddings = vec![
            make_unit_vec(dim, 0), // id 10
            make_unit_vec(dim, 1), // id 20
            make_unit_vec(dim, 2), // id 30
        ];
        let ids = vec![10, 20, 30];

        let index = HnswVectorIndex::from_vecs(embeddings, ids, dim).unwrap();
        assert_eq!(index.len(), 3);

        // Query closest to the second vector
        let query = make_unit_vec(dim, 1);
        let results = index.search(&query, 2).unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].verse_id, 20);
        assert!((results[0].similarity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_empty_index() {
        let index = HnswVectorIndex::from_vecs(vec![], vec![], 4).unwrap();
        assert!(index.is_empty());
        let results = index.search(&[0.0; 4], 5).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_dimension_mismatch() {
        let index =
            HnswVectorIndex::from_vecs(vec![vec![1.0, 0.0]], vec![1], 2).unwrap();
        let err = index.search(&[1.0, 0.0, 0.0], 1);
        assert!(err.is_err());
    }
}
