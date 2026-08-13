//! Fusion of vector-similarity and FTS5/BM25 search results.
//!
//! Single source of truth for the hybrid-search score constants and the
//! merge logic used by the `semantic_search` command. The current strategy
//! assigns FTS5 hits a synthetic rank-derived confidence and sorts them
//! against raw cosine similarities.

use std::collections::HashSet;

/// Confidence assigned to the best FTS5 BM25 match (rank 0).
pub const FTS5_RANK0_CONFIDENCE: f64 = 0.75;

/// Confidence decrease per FTS5 rank position (rank 1 = 0.71, rank 2 = 0.67, etc.).
pub const FTS5_CONFIDENCE_DECAY: f64 = 0.04;

/// FTS5 results below this confidence are not included.
pub const FTS5_MIN_CONFIDENCE: f64 = 0.50;

/// A unique verse reference across translations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct VerseKey {
    pub book_number: i32,
    pub chapter: i32,
    pub verse: i32,
}

/// Which engine produced a fused hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FusedOrigin {
    /// Vector similarity search — `score` is the raw cosine similarity.
    Vector,
    /// FTS5 BM25 — `score` is the synthetic rank-derived confidence.
    Fts5,
}

/// One entry in the fused, score-ordered result list.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FusedHit {
    pub key: VerseKey,
    pub score: f64,
    pub origin: FusedOrigin,
}

/// Merge vector hits (verse key + cosine similarity) with BM25-ranked FTS5
/// verse keys.
///
/// Vector hits keep their cosine similarity. FTS5 hits not already found by
/// the vector search get a synthetic confidence of
/// `FTS5_RANK0_CONFIDENCE − rank × FTS5_CONFIDENCE_DECAY`; the FTS5 list is
/// cut off at the first rank whose confidence drops below
/// `FTS5_MIN_CONFIDENCE`. The combined list is sorted by score descending
/// (stable: vector hits stay ahead of equal-scored FTS5 hits) and is NOT
/// truncated — callers control the length of each input list.
#[expect(clippy::cast_precision_loss, reason = "rank is small")]
pub fn fuse(vector_hits: &[(VerseKey, f64)], fts_keys: &[VerseKey]) -> Vec<FusedHit> {
    let mut results: Vec<FusedHit> = vector_hits
        .iter()
        .map(|&(key, score)| FusedHit { key, score, origin: FusedOrigin::Vector })
        .collect();

    let seen: HashSet<VerseKey> = vector_hits.iter().map(|&(key, _)| key).collect();

    for (rank, &key) in fts_keys.iter().enumerate() {
        let score = FTS5_RANK0_CONFIDENCE - (rank as f64 * FTS5_CONFIDENCE_DECAY);
        if score < FTS5_MIN_CONFIDENCE {
            break;
        }
        if !seen.contains(&key) {
            results.push(FusedHit { key, score, origin: FusedOrigin::Fts5 });
        }
    }

    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(book: i32, chapter: i32, verse: i32) -> VerseKey {
        VerseKey { book_number: book, chapter, verse }
    }

    #[test]
    fn vector_only_keeps_cosine_scores_sorted() {
        let hits = vec![(key(43, 3, 16), 0.61), (key(45, 5, 8), 0.72)];
        let fused = fuse(&hits, &[]);
        assert_eq!(fused.len(), 2);
        assert_eq!(fused[0].key, key(45, 5, 8));
        assert_eq!(fused[0].score, 0.72);
        assert_eq!(fused[0].origin, FusedOrigin::Vector);
        assert_eq!(fused[1].score, 0.61);
    }

    #[test]
    fn fts_only_gets_rank_ladder_and_break() {
        let keys: Vec<VerseKey> = (1..=10).map(|v| key(1, 1, v)).collect();
        let fused = fuse(&[], &keys);
        // Ranks 0..=6 survive (0.75 down to 0.51); rank 7 = 0.47 breaks.
        assert_eq!(fused.len(), 7);
        assert!((fused[0].score - 0.75).abs() < 1e-9);
        assert!((fused[1].score - 0.71).abs() < 1e-9);
        assert!((fused[6].score - 0.51).abs() < 1e-9);
        assert!(fused.iter().all(|h| h.origin == FusedOrigin::Fts5));
    }

    #[test]
    fn verse_found_by_both_keeps_vector_cosine_not_synthetic() {
        let both = key(43, 3, 16);
        let fused = fuse(&[(both, 0.62)], &[both, key(1, 1, 1)]);
        // The overlapping verse appears once, with its cosine score.
        let entries: Vec<&FusedHit> = fused.iter().filter(|h| h.key == both).collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].score, 0.62);
        assert_eq!(entries[0].origin, FusedOrigin::Vector);
        // The seen-skip does not shift later FTS ranks: key(1,1,1) is rank 1 → 0.71.
        let other = fused.iter().find(|h| h.key == key(1, 1, 1)).unwrap();
        assert!((other.score - 0.71).abs() < 1e-9);
    }

    #[test]
    fn synthetic_fts_scores_outrank_typical_cosines() {
        // Documents the current (known-problematic) behavior: FTS rank 0-3
        // beats a strong 0.65 cosine match.
        let fused = fuse(&[(key(43, 3, 16), 0.65)], &[key(1, 1, 1), key(1, 1, 2), key(1, 1, 3)]);
        assert_eq!(fused[0].origin, FusedOrigin::Fts5);
        assert_eq!(fused[3].key, key(43, 3, 16));
    }

    #[test]
    fn equal_scores_keep_vector_before_fts() {
        // A cosine of exactly 0.75 ties FTS rank 0; stable sort keeps the
        // vector hit first (matches the legacy inline behavior).
        let fused = fuse(&[(key(43, 3, 16), 0.75)], &[key(1, 1, 1)]);
        assert_eq!(fused[0].origin, FusedOrigin::Vector);
        assert_eq!(fused[1].origin, FusedOrigin::Fts5);
    }

    #[test]
    fn empty_inputs_produce_empty_output() {
        assert!(fuse(&[], &[]).is_empty());
    }
}
