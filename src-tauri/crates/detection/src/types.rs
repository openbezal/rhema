use serde::{Deserialize, Serialize};

/// A reference to a specific Bible verse or verse range.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, Hash)]
pub struct VerseRef {
    pub book_number: i32,
    pub book_name: String,
    pub chapter: i32,
    pub verse_start: i32,
    pub verse_end: Option<i32>,
}

/// Indicates how a detection was made.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub enum DetectionSource {
    DirectReference,
    Semantic { similarity: f64 },
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
    pub transcript_snippet: String,
    pub detected_at: u64,
    /// True when the detection was emitted from a chapter-only reference (no verse spoken yet).
    /// The verse defaults to 1 and may be refined later when the speaker says the verse number.
    #[serde(default)]
    pub is_chapter_only: bool,
}
