use crate::direct::detector::DirectDetector;
use crate::merger::{DetectionMerger, MergedDetection};
use crate::semantic::detector::SemanticDetector;

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
