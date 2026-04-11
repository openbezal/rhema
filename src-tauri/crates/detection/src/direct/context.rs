use crate::types::VerseRef;
use std::time::Instant;

/// Tracks recent Bible reference context so partial references
/// (e.g., "verse 17" without a book/chapter) can be resolved.
#[expect(clippy::struct_field_names, reason = "last_ prefix conveys temporal context clearly")]
pub struct ReferenceContext {
    last_book: Option<i32>,
    last_book_name: Option<String>,
    last_chapter: Option<i32>,
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

    /// Resolve a partial `VerseRef` by filling in missing book/chapter from context.
    ///
    /// If the `verse_ref` has `book_number` == 0, attempt to fill from context.
    /// If the `verse_ref` has chapter == 0, attempt to fill from context.
    pub fn resolve(&self, partial: &VerseRef) -> VerseRef {
        let mut resolved = partial.clone();

        if !self.is_valid() {
            return resolved;
        }

        // Fill in missing book
        if resolved.book_number == 0 {
            if let Some(book) = self.last_book {
                resolved.book_number = book;
            }
            if let Some(ref name) = self.last_book_name {
                if resolved.book_name.is_empty() {
                    resolved.book_name.clone_from(name);
                }
            }
        }

        // Fill in missing chapter
        if resolved.chapter == 0 && resolved.book_number != 0 {
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
        if verse_ref.book_number != 0 {
            self.last_book = Some(verse_ref.book_number);
            self.last_book_name = Some(verse_ref.book_name.clone());
        }
        if verse_ref.chapter != 0 {
            self.last_chapter = Some(verse_ref.chapter);
        }
        self.last_timestamp = Some(Instant::now());
    }
}

impl Default for ReferenceContext {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_update_and_resolve() {
        let mut ctx = ReferenceContext::new();

        // First detection: full reference
        let full_ref = VerseRef {
            book_number: 43,
            book_name: "John".to_string(),
            chapter: 3,
            verse_start: 16,
            verse_end: None,
        };
        ctx.update(&full_ref);

        // Partial: same book, no chapter
        let partial = VerseRef {
            book_number: 43,
            book_name: "John".to_string(),
            chapter: 0,
            verse_start: 17,
            verse_end: None,
        };
        let resolved = ctx.resolve(&partial);
        assert_eq!(resolved.chapter, 3);
    }

    #[test]
    fn test_no_context() {
        let ctx = ReferenceContext::new();
        let partial = VerseRef {
            book_number: 0,
            book_name: String::new(),
            chapter: 0,
            verse_start: 5,
            verse_end: None,
        };
        let resolved = ctx.resolve(&partial);
        assert_eq!(resolved.book_number, 0); // Unchanged
    }
}
