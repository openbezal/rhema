use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use super::embedder::{StubEmbedder, TextEmbedder};
use super::index::{StubIndex, VectorIndex};
use crate::types::{Detection, DetectionSource, VerseRef};

/// Default cosine-similarity threshold below which results are discarded.
const DEFAULT_CONFIDENCE_THRESHOLD: f64 = 0.50;

/// Orchestrator that combines embedding and vector search to detect Bible
/// verses from transcript text using semantic similarity.
pub struct SemanticDetector {
    embedder: Box<dyn TextEmbedder>,
    index: Box<dyn VectorIndex>,
    confidence_threshold: f64,
}

impl SemanticDetector {
    /// Create a new detector backed by the given embedder and index.
    pub fn new(embedder: Box<dyn TextEmbedder>, index: Box<dyn VectorIndex>) -> Self {
        Self {
            embedder,
            index,
            confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD,
        }
    }

    /// Create a detector with stub (no-op) implementations.
    ///
    /// The stub detector compiles and runs without model files but
    /// always returns empty results because its index is empty.
    pub fn stub() -> Self {
        Self::new(Box::new(StubEmbedder::new(1024)), Box::new(StubIndex))
    }

    /// Returns `true` when the underlying index contains vectors and
    /// the detector can produce meaningful results.
    pub fn is_ready(&self) -> bool {
        !self.index.is_empty()
    }

    /// Detect Bible verses in `text` using semantic similarity.
    ///
    /// The text is embedded and the nearest verses in the vector index are
    /// returned if they exceed the confidence threshold.
    ///
    /// The returned `Detection` objects have placeholder `VerseRef`
    /// fields (all zeros / empty) — the caller is expected to resolve
    /// them using the `verse_id` from the underlying `SearchResult`.
    pub fn detect(&mut self, text: &str) -> Vec<Detection> {
        if !self.is_ready() {
            return vec![];
        }

        let Ok(embedding) = self.embedder.embed(text) else { return vec![] };
        let Ok(results) = self.index.search(&embedding, 5) else { return vec![] };

        let now = Self::timestamp_ms();
        let mut seen_verse_ids = HashSet::new();
        let mut detections = Vec::new();
        for result in &results {
            if result.similarity >= self.confidence_threshold
                && seen_verse_ids.insert(result.verse_id)
            {
                detections.push(Self::make_detection(
                    result.verse_id,
                    result.similarity,
                    text,
                    now,
                ));
            }
        }

        // Cap results: sort by confidence, keep top 5
        detections.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        detections.truncate(5);

        detections
    }

    /// Update the minimum similarity threshold for a result to be
    /// included in the output.
    pub fn set_confidence_threshold(&mut self, threshold: f64) {
        self.confidence_threshold = threshold;
    }

    /// Direct query -> results for manual semantic search.
    /// Unlike `detect()`, this does NOT chunk the text or apply cooldown.
    pub fn search_query(&mut self, query: &str, k: usize) -> Vec<(i64, f64)> {
        if !self.is_ready() {
            return vec![];
        }
        let Ok(embedding) = self.embedder.embed(query) else { return vec![] };
        match self.index.search(&embedding, k) {
            Ok(results) => results.iter().map(|r| (r.verse_id, r.similarity)).collect(),
            Err(_) => vec![],
        }
    }

    // ---- private helpers ----

    #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
    fn timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn make_detection(verse_id: i64, similarity: f64, snippet: &str, detected_at: u64) -> Detection {
        Detection {
            verse_ref: VerseRef {
                book_number: 0,
                book_name: String::new(),
                chapter: 0,
                verse_start: 0,
                verse_end: None,
            },
            verse_id: Some(verse_id),
            confidence: similarity,
            source: DetectionSource::Semantic {
                similarity,
            },
            transcript_snippet: snippet.to_string(),
            detected_at,
            is_chapter_only: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::index::SearchResult;
    use crate::DetectionError;

    /// A fake index that always returns a fixed set of results.
    struct FakeIndex {
        results: Vec<SearchResult>,
    }

    impl VectorIndex for FakeIndex {
        fn search(&self, _query: &[f32], k: usize) -> Result<Vec<SearchResult>, DetectionError> {
            Ok(self.results.iter().take(k).cloned().collect())
        }

        fn len(&self) -> usize {
            self.results.len()
        }
    }

    #[test]
    fn test_stub_returns_empty() {
        let mut detector = SemanticDetector::stub();
        let results = detector.detect("for God so loved the world");
        assert!(results.is_empty());
    }

    #[test]
    fn test_stub_is_not_ready() {
        let detector = SemanticDetector::stub();
        assert!(!detector.is_ready());
    }

    #[test]
    fn test_detection_with_fake_index() {
        let fake_results = vec![
            SearchResult {
                verse_id: 1001,
                similarity: 0.85,
            },
            SearchResult {
                verse_id: 1002,
                similarity: 0.20,
            },
        ];

        let mut detector = SemanticDetector::new(
            Box::new(StubEmbedder::new(128)),
            Box::new(FakeIndex {
                results: fake_results,
            }),
        );

        assert!(detector.is_ready());

        let detections =
            detector.detect("for God so loved the world that he gave his only begotten son");

        // Should include the high-similarity result but not the 0.20 one
        assert!(!detections.is_empty());
        for d in &detections {
            assert!(d.confidence >= 0.35);
            assert!(matches!(
                d.source,
                DetectionSource::Semantic { .. }
            ));
        }
    }

    #[test]
    fn test_threshold_adjustment() {
        let fake_results = vec![SearchResult {
            verse_id: 1001,
            similarity: 0.60,
        }];

        let mut detector = SemanticDetector::new(
            Box::new(StubEmbedder::new(128)),
            Box::new(FakeIndex {
                results: fake_results,
            }),
        );

        // Default threshold is 0.50 — should include 0.60
        let detections = detector.detect("for God so loved the world that he gave his son");
        assert!(!detections.is_empty());

        // Raise threshold above the result's similarity
        detector.set_confidence_threshold(0.70);
        let detections = detector.detect("whoever believes in him shall not perish but have everlasting life");
        assert!(detections.is_empty());
    }
}
