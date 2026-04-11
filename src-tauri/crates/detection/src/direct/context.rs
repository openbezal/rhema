use crate::types::VerseRef;
use std::time::Instant;
use rhema_core::{BookId, ChapterNumber};
use std::sync::Arc;

/// Tracks recent Bible reference context so partial references
/// (e.g., "verse 17" without a book/chapter) can be resolved.
pub struct ReferenceContext {
    last_book: Option<BookId>,
    last_book_name: Option<Arc<str>>,
    last_chapter: Option<ChapterNumber>,
    last_timestamp: Option<Instant>,
}

/// How long context remains valid (60 seconds).
const CONTEXT_TIMEOUT_SECS: u64 = 60;

impl ReferenceContext {
    pub fn new() -> Self {
        ReferenceContext {
            last_book: None,
            last_book_name: None,
            last_chapter: None,
            last_timestamp: None,
        }
    }

    /// Check if context is still valid (within timeout).
    fn is_valid(&self) -> bool {
        match self.last_timestamp {
            Some(ts) => ts.elapsed().as_secs() < CONTEXT_TIMEOUT_SECS,
            None => false,
        }
    }

    /// Resolve a partial VerseRef by filling in missing book/chapter from context.
    pub fn resolve(&self, partial: &VerseRef) -> VerseRef {
        let mut resolved = partial.clone();

        if !self.is_valid() {
            return resolved;
        }

        // Fill in missing book
        if resolved.book_number == BookId(0) {
            if let Some(book) = self.last_book {
                resolved.book_number = book;
            }
            if let Some(ref name) = self.last_book_name {
                if resolved.book_name.is_empty() {
                    resolved.book_name = name.clone();
                }
            }
        }

        // Fill in missing chapter
        if resolved.chapter == ChapterNumber(0) && resolved.book_number != BookId(0) {
            if let Some(chapter) = self.last_chapter {
                // Only fill chapter if same book
                if self.last_book == Some(resolved.book_number) {
                    resolved.chapter = chapter;
                }
            }
        }

        resolved
    }

    /// Update context with the latest detection.
    pub fn update(&mut self, verse_ref: &VerseRef) {
        if verse_ref.book_number != BookId(0) {
            self.last_book = Some(verse_ref.book_number);
            self.last_book_name = Some(verse_ref.book_name.clone());
        }
        if verse_ref.chapter != ChapterNumber(0) {
            self.last_chapter = Some(verse_ref.chapter);
        }
        self.last_timestamp = Some(Instant::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_update_and_resolve() {
        let mut ctx = ReferenceContext::new();

        // First detection: full reference (John 3:16)
        let full_ref = VerseRef {
            book_number: BookId(43),
            book_name: Arc::from("John"),
            chapter: ChapterNumber(3),
            verse_start: VerseNumber(16),
            verse_end: None,
        };
        ctx.update(&full_ref);

        // Partial: same book, no chapter
        let partial = VerseRef {
            book_number: BookId(43),
            book_name: Arc::from("John"),
            chapter: ChapterNumber(0),
            verse_start: VerseNumber(17),
            verse_end: None,
        };
        let resolved = ctx.resolve(&partial);
        assert_eq!(resolved.chapter, ChapterNumber(3));
    }

    #[test]
    fn test_no_context() {
        let ctx = ReferenceContext::new();
        let partial = VerseRef {
            book_number: BookId(0),
            book_name: Arc::from(""),
            chapter: ChapterNumber(0),
            verse_start: VerseNumber(5),
            verse_end: None,
        };
        let resolved = ctx.resolve(&partial);
        assert_eq!(resolved.book_number, BookId(0)); // Unchanged
    }
}
