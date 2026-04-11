use std::sync::Arc;
use std::time::Instant;

use crate::types::{Detection, DetectionSource};
use crate::context::SermonContext;
use rhema_core::{BookId, ChapterNumber, VerseNumber};

/// Default confidence threshold — detections below this are dropped.
const DEFAULT_CONFIDENCE_THRESHOLD: f64 = 0.45;

/// Default auto-queue threshold — detections above this are auto-queued.
const DEFAULT_AUTO_QUEUE_THRESHOLD: f64 = 0.80;

/// Default cooldown in milliseconds between auto-displayed results.
const DEFAULT_COOLDOWN_MS: u64 = 2500;

/// A detection after merging, with an auto-queue flag.
#[derive(Debug, Clone, PartialEq)]
pub struct MergedDetection {
    pub detection: Detection,
    pub auto_queued: bool,
}

/// Merges results from direct reference detection and semantic search
/// into a single ranked list.
///
/// # Dedup strategy
/// When both direct and semantic detectors match the same verse
/// (same `book_number` + `chapter` + `verse_start`), the direct detection
/// is kept because it has higher trust (confidence >= 0.90).
///
/// # Auto-queue
/// High-confidence results are marked `auto_queued = true` so the UI
/// can display them immediately. A cooldown timer prevents flooding
/// the user with too many auto-displayed results.
pub struct DetectionMerger {
    confidence_threshold: f64,
    auto_queue_threshold: f64,
    cooldown_ms: u64,
    last_auto_display: Option<Instant>,
}

/// Core result ranking and merging logic for Bible detection.
impl DetectionMerger {
    /// Create a new DetectionMerger with default mainnet-tier configuration.
    pub fn new() -> Self {
        Self {
            confidence_threshold: DEFAULT_CONFIDENCE_THRESHOLD,
            auto_queue_threshold: DEFAULT_AUTO_QUEUE_THRESHOLD,
            cooldown_ms: DEFAULT_COOLDOWN_MS,
            last_auto_display: None,
        }
    }

    /// Merge direct and semantic detections into a ranked list.
    pub fn merge(
        &mut self,
        direct: Vec<Detection>,
        semantic: Vec<Detection>,
    ) -> Vec<MergedDetection> {
        let mut all: Vec<Detection> = Vec::with_capacity(direct.len() + semantic.len());
        all.extend(direct);

        for s in semantic {
            let dominated = all.iter().any(|d| {
                matches!(d.source, DetectionSource::DirectReference)
                    && d.verse_ref.book_number == s.verse_ref.book_number
                    && d.verse_ref.chapter == s.verse_ref.chapter
                    && d.verse_ref.verse_start == s.verse_ref.verse_start
            });
            if !dominated {
                all.push(s);
            }
        }

        all.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        all.retain(|d| d.confidence >= self.confidence_threshold);

        let now = Instant::now();
        let cooldown_ok = match self.last_auto_display {
            Some(last) => now.duration_since(last).as_millis() as u64 >= self.cooldown_ms,
            None => true,
        };

        let mut results = Vec::with_capacity(all.len());
        for detection in all {
            let auto_queued =
                detection.confidence >= self.auto_queue_threshold && cooldown_ok;
            if auto_queued {
                self.last_auto_display = Some(now);
            }
            results.push(MergedDetection {
                detection,
                auto_queued,
            });
        }

        results
    }

    /// Apply context boosting to detections matching recent session history.
    pub fn apply_context_boost(
        detections: &mut [Detection],
        context: &SermonContext,
    ) {
        for detection in detections.iter_mut() {
            let boost = context.confidence_boost(
                detection.verse_ref.book_number,
                detection.verse_ref.chapter,
            );
            if boost > 0.0 {
                detection.confidence = (detection.confidence + boost).min(1.0);
            }
        }
    }
}

/// Configuration and Management for DetectionMerger.
impl DetectionMerger {
    /// Update the minimum confidence threshold.
    pub fn set_confidence_threshold(&mut self, threshold: f64) {
        self.confidence_threshold = threshold;
    }

    /// Update the auto-queue threshold.
    pub fn set_auto_queue_threshold(&mut self, threshold: f64) {
        self.auto_queue_threshold = threshold;
    }

    /// Update the cooldown between auto-displayed results.
    pub fn set_cooldown_ms(&mut self, ms: u64) {
        self.cooldown_ms = ms;
    }
}

impl Default for DetectionMerger {
    fn default() -> Self {
        Self::new()
    }
}

# [ cfg ( test ) ]
mod tests {
    use super::*;
    use crate::types::{DetectionSource, VerseRef};

    fn make_detection(
        book_number: BookId,
        book_name: &str,
        chapter: ChapterNumber,
        verse_start: VerseNumber,
        confidence: f64,
        source: DetectionSource,
    ) -> Detection {
        let book_name_arc: Arc<str> = Arc::from(book_name);
        Detection {
            verse_ref: VerseRef {
                book_number,
                book_name: book_name_arc.clone(),
                chapter,
                verse_start,
                verse_end: None,
            },
            verse_id: None,
            confidence,
            source,
            transcript_snippet: Arc::from(format!("{} {}:{}", book_name_arc, chapter, verse_start).as_str()),
            detected_at: 0,
        }
    }

    #[test]
    fn test_merger_dedup_keeps_direct() {
        let mut merger = DetectionMerger::new();

        let direct = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.96,
            DetectionSource::DirectReference,
        )];
        let semantic = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.72,
            DetectionSource::SemanticLocal { similarity: 0.72 },
        )];

        let results = merger.merge(direct, semantic);
        assert_eq!(results.len(), 1);
        assert!(matches!(
            results[0].detection.source,
            DetectionSource::DirectReference
        ));
        assert!((results[0].detection.confidence - 0.96).abs() < f64::EPSILON);
    }

    #[test]
    fn test_merger_keeps_distinct_verses() {
        let mut merger = DetectionMerger::new();

        let direct = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.96,
            DetectionSource::DirectReference,
        )];
        let semantic = vec![make_detection(
            BookId(45u8),
            "Romans",
            ChapterNumber(8u16),
            VerseNumber(28u16),
            0.65,
            DetectionSource::SemanticLocal { similarity: 0.65 },
        )];

        let results = merger.merge(direct, semantic);
        assert_eq!(results.len(), 2);
        // Sorted by confidence descending
        assert_eq!(results[0].detection.verse_ref.book_name.as_ref(), "John");
        assert_eq!(results[1].detection.verse_ref.book_name.as_ref(), "Romans");
    }

    #[test]
    fn test_merger_drops_below_threshold() {
        let mut merger = DetectionMerger::new();

        let direct = vec![];
        let semantic = vec![
            make_detection(
                BookId(43u8),
                "John",
                ChapterNumber(3u16),
                VerseNumber(16u16),
                0.50,
                DetectionSource::SemanticLocal { similarity: 0.50 },
            ),
            make_detection(
                BookId(45u8),
                "Romans",
                ChapterNumber(8u16),
                VerseNumber(28u16),
                0.20, // below threshold
                DetectionSource::SemanticLocal { similarity: 0.20 },
            ),
        ];

        let results = merger.merge(direct, semantic);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].detection.verse_ref.book_name.as_ref(), "John");
    }

    #[test]
    fn test_merger_auto_queue() {
        let mut merger = DetectionMerger::new();

        let direct = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.96,
            DetectionSource::DirectReference,
        )];

        let results = merger.merge(direct, vec![]);
        assert_eq!(results.len(), 1);
        assert!(results[0].auto_queued);
    }

    #[test]
    fn test_merger_auto_queue_below_threshold() {
        let mut merger = DetectionMerger::new();

        let semantic = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.50,
            DetectionSource::SemanticLocal { similarity: 0.50 },
        )];

        let results = merger.merge(vec![], semantic);
        assert_eq!(results.len(), 1);
        assert!(!results[0].auto_queued);
    }

    #[test]
    fn test_merger_sort_order() {
        let mut merger = DetectionMerger::new();

        let direct = vec![make_detection(
            BookId(43u8),
            "John",
            ChapterNumber(3u16),
            VerseNumber(16u16),
            0.90,
            DetectionSource::DirectReference,
        )];
        let semantic = vec![
            make_detection(
                BookId(45u8),
                "Romans",
                ChapterNumber(8u16),
                VerseNumber(28u16),
                0.95,
                DetectionSource::SemanticLocal { similarity: 0.95 },
            ),
            make_detection(
                BookId(1u8),
                "Genesis",
                ChapterNumber(1u16),
                VerseNumber(1u16),
                0.60,
                DetectionSource::SemanticLocal { similarity: 0.60 },
            ),
        ];

        let results = merger.merge(direct, semantic);
        assert_eq!(results.len(), 3);
        assert!((results[0].detection.confidence - 0.95).abs() < f64::EPSILON);
        assert!((results[1].detection.confidence - 0.90).abs() < f64::EPSILON);
        assert!((results[2].detection.confidence - 0.60).abs() < f64::EPSILON);
    }

    #[test]
    fn test_merger_empty_inputs() {
        let mut merger = DetectionMerger::new();
        let results = merger.merge(vec![], vec![]);
        assert!(results.is_empty());
    }
}
