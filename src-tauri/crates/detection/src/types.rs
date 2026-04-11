use serde::{Deserialize, Serialize};
use rhema_core::{BookId, ChapterNumber, VerseNumber};
use std::sync::Arc;

/// A reference to a specific Bible verse or verse range.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
pub struct VerseRef {
    pub book_number: BookId,
    pub book_name: Arc<str>,
    pub chapter: ChapterNumber,
    pub verse_start: VerseNumber,
    pub verse_end: Option<VerseNumber>,
}

/// Indicates how a detection was made.
#[non_exhaustive]
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum DetectionSource {
    DirectReference,
    Contextual,
    QuotationMatch { similarity: f64 },
    SemanticLocal { similarity: f64 },
    SemanticCloud { similarity: f64 },
}

/// A single detected Bible reference in transcript text.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Detection {
    pub verse_ref: VerseRef,
    /// Database primary key from semantic search (verses.id).
    /// Only set for semantic detections; direct detections use `verse_ref` fields instead.
    pub verse_id: Option<i64>,
    pub confidence: f64,
    pub source: DetectionSource,
    pub transcript_snippet: Arc<str>,
    pub detected_at: u64,
}
