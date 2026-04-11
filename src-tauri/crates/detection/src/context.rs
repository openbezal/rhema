use std::time::Instant;

use crate::types::VerseRef;

/// How long context remains valid (3 minutes, matching Logos AI).
const CONTEXT_TIMEOUT_SECS: u64 = 180;

/// Confidence boost for detections in the same book as the current context.
pub const SAME_BOOK_BOOST: f64 = 0.05;

/// Confidence boost for detections in the same chapter as the current context.
pub const SAME_CHAPTER_BOOST: f64 = 0.10;

/// A timestamped detection entry in the session history.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEntry {
    pub timestamp_ms: u64,
    pub verse_ref: VerseRef,
    pub confidence: f64,
    pub source: String,
}

/// Tracks the sermon context — current book/chapter focus, session history,
/// and provides confidence boosting for contextually relevant detections.
///
/// Logos AI maintains context for approximately 3 minutes of sermon audio.
/// Context is refreshed on each new explicit reference.
pub struct SermonContext {
    /// The currently focused book number (from most recent detection).
    current_book: Option<i32>,
    /// The currently focused chapter (from most recent detection).
    current_chapter: Option<i32>,
    /// When the context was last updated.
    last_update: Option<Instant>,
    /// History of all detected verses this session.
    session_history: Vec<SessionEntry>,
}

impl SermonContext {
    pub fn new() -> Self {
        Self {
            current_book: None,
            current_chapter: None,
            last_update: None,
            session_history: Vec::new(),
        }
    }

    /// Check if context is still valid (within timeout).
    pub fn is_valid(&self) -> bool {
        match self.last_update {
            Some(ts) => ts.elapsed().as_secs() < CONTEXT_TIMEOUT_SECS,
            None => false,
        }
    }

    /// Update context with a new detection.
    pub fn update(&mut self, verse_ref: &VerseRef, confidence: f64, source: &str) {
        if verse_ref.book_number > 0 {
            self.current_book = Some(verse_ref.book_number);
        }
        if verse_ref.chapter > 0 {
            self.current_chapter = Some(verse_ref.chapter);
        }
        self.last_update = Some(Instant::now());

        #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        self.session_history.push(SessionEntry {
            timestamp_ms: now,
            verse_ref: verse_ref.clone(),
            confidence,
            source: source.to_string(),
        });
    }

    /// Get the current book number in focus (if context is valid).
    pub fn current_book(&self) -> Option<i32> {
        if self.is_valid() {
            self.current_book
        } else {
            None
        }
    }

    /// Get the current chapter in focus (if context is valid).
    pub fn current_chapter(&self) -> Option<i32> {
        if self.is_valid() {
            self.current_chapter
        } else {
            None
        }
    }

    /// Calculate confidence boost for a detection based on current context.
    ///
    /// - Same book: +0.05
    /// - Same book AND chapter: +0.10 (replaces book boost, not additive)
    pub fn confidence_boost(&self, book_number: i32, chapter: i32) -> f64 {
        if !self.is_valid() {
            return 0.0;
        }

        if let Some(ctx_book) = self.current_book {
            if ctx_book == book_number {
                if let Some(ctx_chapter) = self.current_chapter {
                    if ctx_chapter == chapter {
                        return SAME_CHAPTER_BOOST;
                    }
                }
                return SAME_BOOK_BOOST;
            }
        }

        0.0
    }

    /// Get the full session history.
    pub fn history(&self) -> &[SessionEntry] {
        &self.session_history
    }

    /// Clear session history (e.g., when starting a new service).
    pub fn clear_session(&mut self) {
        self.session_history.clear();
        self.current_book = None;
        self.current_chapter = None;
        self.last_update = None;
    }

    /// Find the most recent detection for a given book (for "back in Genesis" pattern).
    pub fn last_in_book(&self, book_number: i32) -> Option<&VerseRef> {
        self.session_history
            .iter()
            .rev()
            .find(|e| e.verse_ref.book_number == book_number)
            .map(|e| &e.verse_ref)
    }
}

impl Default for SermonContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ref(book: i32, chapter: i32, verse: i32) -> VerseRef {
        VerseRef {
            book_number: book,
            book_name: "Test".to_string(),
            chapter,
            verse_start: verse,
            verse_end: None,
        }
    }

    #[test]
    fn test_new_context_not_valid() {
        let ctx = SermonContext::new();
        assert!(!ctx.is_valid());
        assert_eq!(ctx.confidence_boost(1, 1), 0.0);
    }

    #[test]
    fn test_update_makes_valid() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct");
        assert!(ctx.is_valid());
        assert_eq!(ctx.current_book(), Some(45));
        assert_eq!(ctx.current_chapter(), Some(8));
    }

    #[test]
    fn test_same_book_boost() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct"); // Romans 8:28
        // Same book (Romans), different chapter
        assert!((ctx.confidence_boost(45, 3) - SAME_BOOK_BOOST).abs() < f64::EPSILON);
    }

    #[test]
    fn test_same_chapter_boost() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct"); // Romans 8:28
        // Same book AND chapter
        assert!((ctx.confidence_boost(45, 8) - SAME_CHAPTER_BOOST).abs() < f64::EPSILON);
    }

    #[test]
    fn test_different_book_no_boost() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct"); // Romans
        // Different book (John)
        assert_eq!(ctx.confidence_boost(43, 3), 0.0);
    }

    #[test]
    fn test_session_history() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct");
        ctx.update(&make_ref(45, 8, 29), 0.88, "contextual");
        assert_eq!(ctx.history().len(), 2);
    }

    #[test]
    fn test_clear_session() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct");
        ctx.clear_session();
        assert!(!ctx.is_valid());
        assert!(ctx.history().is_empty());
    }

    #[test]
    fn test_last_in_book() {
        let mut ctx = SermonContext::new();
        ctx.update(&make_ref(45, 8, 28), 0.95, "direct");  // Romans
        ctx.update(&make_ref(43, 3, 16), 0.90, "direct");  // John
        ctx.update(&make_ref(45, 9, 1), 0.85, "direct");   // Romans again

        let last_romans = ctx.last_in_book(45).unwrap();
        assert_eq!(last_romans.chapter, 9);
        assert_eq!(last_romans.verse_start, 1);
    }
}
