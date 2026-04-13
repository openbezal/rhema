use std::time::{SystemTime, UNIX_EPOCH};

use rhema_bible::Bm25Result;

use crate::direct::detector::DirectDetector;
use crate::merger::{DetectionMerger, MergedDetection};
use crate::semantic::detector::SemanticDetector;
use crate::types::{Detection, DetectionSource, VerseRef};

/// Confidence assigned to the best FTS5 BM25 match (rank 0).
const FTS5_RANK0_CONFIDENCE: f64 = 0.75;

/// Confidence decrease per FTS5 rank position (rank 1 = 0.71, rank 2 = 0.67, etc.).
const FTS5_CONFIDENCE_DECAY: f64 = 0.04;

/// FTS5 results below this confidence are not included.
const FTS5_MIN_CONFIDENCE: f64 = 0.50;

/// Minimum word count for vector embedding search (short text lacks semantic signal).
const MIN_WORDS_FOR_VECTOR: usize = 5;

/// The main detection pipeline that runs on each transcript segment.
///
/// Orchestrates direct reference detection, semantic search, and merging
/// into a single call. Consumers should create one pipeline and reuse it
/// across transcript segments so that the merger's cooldown state is preserved.
pub struct DetectionPipeline {
    direct: DirectDetector,
    semantic: SemanticDetector,
    merger: DetectionMerger,
}

impl DetectionPipeline {
    pub fn new() -> Self {
        Self {
            direct: DirectDetector::new(),
            semantic: SemanticDetector::stub(),
            merger: DetectionMerger::new(),
        }
    }

    /// Replace the semantic detector (e.g., after loading an ONNX model).
    pub fn set_semantic(&mut self, detector: SemanticDetector) {
        self.semantic = detector;
    }

    /// Access the direct detector for configuration.
    pub fn direct_mut(&mut self) -> &mut DirectDetector {
        &mut self.direct
    }

    /// Access the merger for threshold configuration.
    pub fn merger_mut(&mut self) -> &mut DetectionMerger {
        &mut self.merger
    }

    /// Run the full pipeline (direct + semantic + merge). Used by `detect_verses` command.
    pub fn process(&mut self, text: &str) -> Vec<MergedDetection> {
        let direct_results = self.direct.detect(text);

        let semantic_results = if text.split_whitespace().count() >= MIN_WORDS_FOR_VECTOR {
            self.semantic.detect(text)
        } else {
            vec![]
        };

        self.merger.merge(direct_results, semantic_results)
    }

    /// Run only direct (regex/pattern) detection. Instant, no ONNX inference.
    /// Used during live transcription on every `is_final` fragment.
    pub fn process_direct(&mut self, text: &str) -> Vec<MergedDetection> {
        let direct_results = self.direct.detect(text);
        self.merger.merge(direct_results, vec![])
    }

    /// Run only semantic (ONNX embedding) detection. Slow, 50-400ms.
    /// Used on `speech_final` only, in a background task.
    pub fn process_semantic(&mut self, text: &str) -> Vec<MergedDetection> {
        if text.split_whitespace().count() < MIN_WORDS_FOR_VECTOR {
            return vec![];
        }
        let semantic_results = self.semantic.detect(text);
        self.merger.merge(vec![], semantic_results)
    }

    /// Check if semantic search is available (model loaded + index populated).
    pub fn has_semantic(&self) -> bool {
        self.semantic.is_ready()
    }

    /// Enable or disable synonym expansion (paraphrase detection mode).
    pub fn set_use_synonyms(&mut self, enabled: bool) {
        self.semantic.set_use_synonyms(enabled);
    }

    /// Returns whether synonym expansion is currently enabled.
    pub fn use_synonyms(&self) -> bool {
        self.semantic.use_synonyms()
    }

    /// Run hybrid semantic detection combining vector search with pre-fetched
    /// FTS5 BM25 results. Used by the real-time STT pipeline.
    ///
    /// Vector results found by both methods get a confidence boost;
    /// FTS5-only results are added with rank-derived confidence.
    #[expect(clippy::cast_precision_loss, reason = "rank index is small")]
    pub fn process_hybrid_with_fts(
        &mut self,
        text: &str,
        fts_results: &[Bm25Result],
    ) -> Vec<MergedDetection> {
        // Vector search needs enough words for meaningful embeddings;
        // FTS5 keyword matching works with fewer words.
        let mut vector_detections = if text.split_whitespace().count() >= MIN_WORDS_FOR_VECTOR {
            self.semantic.detect(text)
        } else {
            vec![]
        };

        if fts_results.is_empty() {
            return self.merger.merge(vec![], vector_detections);
        }

        // Add FTS5 results as detections with populated VerseRef (no verse_id).
        // The merger will dedup if both vector and FTS5 find the same verse.
        // to_result() resolves VerseRef via the active translation's db.get_verse().
        #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64")]
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let snippet = text.to_string();
        for (rank, fts) in fts_results.iter().enumerate() {
            let confidence = FTS5_RANK0_CONFIDENCE - (rank as f64 * FTS5_CONFIDENCE_DECAY);
            if confidence < FTS5_MIN_CONFIDENCE {
                break;
            }
            log::debug!(
                "[HYBRID] FTS5 hit: {} {}:{} rank={} conf={:.0}%",
                fts.book_name, fts.chapter, fts.verse,
                rank,
                confidence * 100.0
            );
            vector_detections.push(Detection {
                verse_ref: VerseRef {
                    book_number: fts.book_number,
                    book_name: fts.book_name.clone(),
                    chapter: fts.chapter,
                    verse_start: fts.verse,
                    verse_end: None,
                },
                verse_id: None,
                confidence,
                source: DetectionSource::Semantic { similarity: confidence },
                transcript_snippet: snippet.clone(),
                detected_at: now,
                is_chapter_only: false,
            });
        }

        self.merger.merge(vec![], vector_detections)
    }

    /// Run a standalone semantic search query (for the search UI).
    pub fn semantic_search(&mut self, query: &str, k: usize) -> Vec<(i64, f64)> {
        self.semantic.search_query(query, k)
    }

}

impl Default for DetectionPipeline {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_direct_only() {
        let mut pipeline = DetectionPipeline::new();
        let results = pipeline.process("Jesus said in John 3:16 that God loved the world");
        assert!(!results.is_empty());
        assert_eq!(results[0].detection.verse_ref.book_name, "John");
        assert_eq!(results[0].detection.verse_ref.chapter, 3);
        assert_eq!(results[0].detection.verse_ref.verse_start, 16);
    }

    #[test]
    fn test_pipeline_no_match() {
        let mut pipeline = DetectionPipeline::new();
        let results = pipeline.process("The weather is nice today");
        assert!(results.is_empty());
    }

    #[test]
    fn test_pipeline_multiple_references() {
        let mut pipeline = DetectionPipeline::new();
        let results =
            pipeline.process("Compare John 3:16 with Romans 5:8 for understanding God's love");
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_pipeline_semantic_not_ready_by_default() {
        let pipeline = DetectionPipeline::new();
        assert!(!pipeline.has_semantic());
    }

    #[test]
    fn test_pipeline_auto_queue_for_direct() {
        let mut pipeline = DetectionPipeline::new();
        let results = pipeline.process("John 3:16");
        assert!(!results.is_empty());
        // Direct references have confidence >= 0.90 which is above the
        // default auto_queue_threshold (0.80), so should be auto-queued.
        assert!(results[0].auto_queued);
    }
}
