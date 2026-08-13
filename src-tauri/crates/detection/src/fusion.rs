//! Fusion of vector-similarity and FTS5/BM25 search results.
//!
//! Single source of truth for the hybrid-search score constants and the
//! merge logic used by the `semantic_search` command. The search path uses
//! Reciprocal Rank Fusion ([`fuse_rrf`]); the legacy synthetic-confidence
//! strategy ([`fuse`]) remains for the live-STT confidence ladder.

use std::collections::{HashMap, HashSet};

/// Confidence assigned to the best FTS5 BM25 match (rank 0).
pub const FTS5_RANK0_CONFIDENCE: f64 = 0.75;

/// Confidence decrease per FTS5 rank position (rank 1 = 0.71, rank 2 = 0.67, etc.).
pub const FTS5_CONFIDENCE_DECAY: f64 = 0.04;

/// FTS5 results below this confidence are not included.
pub const FTS5_MIN_CONFIDENCE: f64 = 0.50;

/// Reciprocal Rank Fusion constant: `score = Σ 1/(RRF_K + rank)` with
/// 1-based ranks. 60 is the standard value from the original RRF paper and
/// works well without tuning.
pub const RRF_K: f64 = 60.0;

/// Vector candidates below this cosine similarity are discarded before
/// fusion — the brute-force index always returns k results, so the tail is
/// noise on queries with no real semantic match.
pub const VECTOR_SIMILARITY_FLOOR: f64 = 0.40;

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

/// One entry in the RRF-fused result list.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RrfHit {
    pub key: VerseKey,
    /// Reciprocal-rank-fusion score — used for ordering only, not display.
    pub score: f64,
    /// Cosine similarity when the vector engine found this verse.
    pub cosine: Option<f64>,
    /// True when the FTS5/BM25 engine found this verse.
    pub from_fts: bool,
}

/// Merge vector hits with BM25-ranked FTS5 verse keys using Reciprocal Rank
/// Fusion: `score(v) = Σ 1/(RRF_K + rank)` over both ranked lists (1-based
/// ranks), so a verse found by BOTH engines sums two contributions and
/// naturally outranks single-engine hits at comparable ranks. Engine scores
/// participate only through their ranks — cosine similarities and synthetic
/// BM25 confidences are never compared on one axis (the legacy fusion did,
/// which let mediocre keyword-only hits bury the verse both engines agreed
/// on).
///
/// Vector candidates below `VECTOR_SIMILARITY_FLOOR` are dropped first.
/// The result is sorted by fused score descending and truncated to `limit`.
#[expect(clippy::cast_precision_loss, reason = "rank is small")]
pub fn fuse_rrf(
    vector_hits: &[(VerseKey, f64)],
    fts_keys: &[VerseKey],
    limit: usize,
) -> Vec<RrfHit> {
    let mut combined: Vec<RrfHit> = Vec::new();
    let mut index_of: HashMap<VerseKey, usize> = HashMap::new();

    for (rank, &(key, cosine)) in vector_hits
        .iter()
        .filter(|&&(_, sim)| sim >= VECTOR_SIMILARITY_FLOOR)
        .enumerate()
    {
        let contribution = 1.0 / (RRF_K + rank as f64 + 1.0);
        let entry_index = *index_of.entry(key).or_insert_with(|| {
            combined.push(RrfHit { key, score: 0.0, cosine: None, from_fts: false });
            combined.len() - 1
        });
        let entry = &mut combined[entry_index];
        entry.score += contribution;
        // Duplicate keys cannot occur within one engine's list in practice;
        // keep the best cosine if they ever do.
        entry.cosine = Some(entry.cosine.map_or(cosine, |c: f64| c.max(cosine)));
    }

    for (rank, &key) in fts_keys.iter().enumerate() {
        let contribution = 1.0 / (RRF_K + rank as f64 + 1.0);
        let entry_index = *index_of.entry(key).or_insert_with(|| {
            combined.push(RrfHit { key, score: 0.0, cosine: None, from_fts: false });
            combined.len() - 1
        });
        let entry = &mut combined[entry_index];
        if !entry.from_fts {
            entry.score += contribution;
            entry.from_fts = true;
        }
    }

    combined.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    combined.truncate(limit);
    combined
}

/// Merge vector hits (verse key + cosine similarity) with BM25-ranked FTS5
/// verse keys.
///
/// Legacy strategy: kept because its constants still drive the live-STT
/// confidence ladder; the search UI path uses [`fuse_rrf`] instead.
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

    // ── fuse_rrf ────────────────────────────────────────────────────

    #[test]
    fn rrf_both_found_outranks_single_found_at_equal_ranks() {
        let both = key(43, 3, 16);
        let vector_only = key(45, 5, 8);
        let fts_only = key(1, 1, 1);
        // `both` is rank 2 in each list; the single-engine hits are rank 1.
        let fused = fuse_rrf(
            &[(vector_only, 0.70), (both, 0.65)],
            &[fts_only, both],
            10,
        );
        assert_eq!(fused[0].key, both);
        assert!(fused[0].from_fts);
        assert_eq!(fused[0].cosine, Some(0.65));
    }

    #[test]
    fn rrf_exact_phrase_fts_top_hit_stays_on_top() {
        // FTS rank 1 with no vector agreement anywhere: 1/(60+1) beats every
        // deeper single-engine rank.
        let fused = fuse_rrf(
            &[(key(45, 5, 8), 0.72), (key(19, 23, 1), 0.60)],
            &[key(43, 3, 16), key(1, 1, 1)],
            10,
        );
        // Vector rank 1 ties FTS rank 1; both precede all rank-2 hits.
        let top_two: Vec<VerseKey> = fused[..2].iter().map(|h| h.key).collect();
        assert!(top_two.contains(&key(43, 3, 16)));
        assert!(top_two.contains(&key(45, 5, 8)));
    }

    #[test]
    fn rrf_applies_cosine_floor() {
        let junk = key(1, 1, 1);
        let good = key(43, 3, 16);
        let fused = fuse_rrf(&[(good, 0.62), (junk, 0.30)], &[], 10);
        assert_eq!(fused.len(), 1);
        assert_eq!(fused[0].key, good);
    }

    #[test]
    fn rrf_floor_shifts_later_vector_ranks_up() {
        // A filtered-out candidate must not consume a rank position.
        let fused = fuse_rrf(&[(key(1, 1, 1), 0.39), (key(43, 3, 16), 0.62)], &[], 10);
        assert_eq!(fused.len(), 1);
        // Rank 1 contribution, not rank 2.
        assert!((fused[0].score - 1.0 / 61.0).abs() < 1e-12);
    }

    #[test]
    fn rrf_dedups_two_directionally() {
        let both = key(43, 3, 16);
        let fused = fuse_rrf(&[(both, 0.65)], &[both], 10);
        assert_eq!(fused.len(), 1);
        assert!((fused[0].score - 2.0 / 61.0).abs() < 1e-12);
        assert!(fused[0].from_fts);
        assert_eq!(fused[0].cosine, Some(0.65));
    }

    #[test]
    fn rrf_truncates_to_limit() {
        let keys: Vec<VerseKey> = (1..=10).map(|v| key(1, 1, v)).collect();
        let fused = fuse_rrf(&[], &keys, 3);
        assert_eq!(fused.len(), 3);
        assert_eq!(fused[0].key, key(1, 1, 1));
    }

    #[test]
    fn rrf_empty_inputs() {
        assert!(fuse_rrf(&[], &[], 10).is_empty());
    }
}
