use serde::Serialize;
use std::sync::Arc;
use rhema_core::{BookId, ChapterNumber, VerseNumber};

/// Serializable detection result for the frontend
#[derive(Clone, Serialize)]
pub struct DetectionResult {
    pub verse_ref: String,
    pub verse_text: Arc<str>,
    pub book_name: Arc<str>,
    pub book_number: BookId,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub confidence: f64,
    pub source: String,
    pub auto_queued: bool,
    pub transcript_snippet: Arc<str>,
}

#[derive(Serialize)]
pub struct DetectionStatusResult {
    pub has_direct: bool,
    pub has_semantic: bool,
    pub has_cloud: bool,
    pub paraphrase_enabled: bool,
}

#[derive(Serialize)]
pub struct SemanticSearchResult {
    pub verse_ref: String,
    pub verse_text: Arc<str>,
    pub book_name: Arc<str>,
    pub book_number: BookId,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub similarity: f64,
}

#[derive(Serialize)]
pub struct QuotationSearchResult {
    pub verse_ref: String,
    pub verse_text: Arc<str>,
    pub book_name: Arc<str>,
    pub book_number: BookId,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub similarity: f64,
}

#[derive(Serialize)]
pub struct ReadingModeStatus {
    pub active: bool,
    pub current_verse: Option<i32>,
}
