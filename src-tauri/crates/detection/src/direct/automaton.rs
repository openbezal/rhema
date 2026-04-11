use aho_corasick::{AhoCorasick, MatchKind};

use super::books::BOOKS;

/// A match of a Bible book name found in text.
#[derive(Debug, Clone)]
pub struct BookMatch {
    pub book_number: i32,
    pub book_name: String,
    pub start: usize,
    pub end: usize,
}

/// Aho-Corasick-based matcher for Bible book names, abbreviations, and aliases.
pub struct BookMatcher {
    automaton: AhoCorasick,
    /// Maps each pattern index to its (`book_number`, `canonical_name`).
    pattern_map: Vec<(i32, String)>,
}

impl Default for BookMatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl BookMatcher {
    /// Build the automaton from all book names, abbreviations, and aliases.
    pub fn new() -> Self {
        let mut patterns: Vec<String> = Vec::new();
        let mut pattern_map: Vec<(i32, String)> = Vec::new();

        for book in BOOKS {
            // Add the canonical name
            patterns.push(book.name.to_lowercase());
            pattern_map.push((book.number, book.name.to_string()));

            // Add the abbreviation (if different from name)
            let abbr_lower = book.abbreviation.to_lowercase();
            if abbr_lower != book.name.to_lowercase() {
                patterns.push(abbr_lower);
                pattern_map.push((book.number, book.name.to_string()));
            }

            // Add all aliases
            for alias in book.aliases {
                let alias_lower = alias.to_lowercase();
                // Avoid duplicates with name and abbreviation
                if alias_lower != book.name.to_lowercase()
                    && alias_lower != book.abbreviation.to_lowercase()
                {
                    patterns.push(alias_lower);
                    pattern_map.push((book.number, book.name.to_string()));
                }
            }
        }

        let automaton = AhoCorasick::builder()
            .ascii_case_insensitive(true)
            .match_kind(MatchKind::Standard)
            .build(&patterns)
            .expect("Failed to build Aho-Corasick automaton");

        BookMatcher {
            automaton,
            pattern_map,
        }
    }

    /// Find all Bible book name matches in the given text.
    ///
    /// Results are filtered so that only matches occurring at word boundaries
    /// are returned, and overlapping matches are resolved in favor of the longest.
    pub fn find_books(&self, text: &str) -> Vec<BookMatch> {
        let text_lower = text.to_lowercase();
        let text_bytes = text_lower.as_bytes();
        let mut raw_matches: Vec<BookMatch> = Vec::new();

        // Use overlapping iterator to get ALL possible matches,
        // including longer patterns that share a start position with shorter ones.
        let mut state = aho_corasick::automaton::OverlappingState::start();
        loop {
            self.automaton
                .find_overlapping(&text_lower, &mut state);
            let Some(mat) = state.get_match() else {
                break;
            };

            let idx = mat.pattern().as_usize();
            let (book_number, ref book_name) = self.pattern_map[idx];
            let start = mat.start();
            let end = mat.end();

            // Check word boundary at start
            if start > 0 {
                let prev = text_bytes[start - 1];
                if prev.is_ascii_alphanumeric() {
                    continue;
                }
            }
            // Check word boundary at end
            if end < text_bytes.len() {
                let next = text_bytes[end];
                if next.is_ascii_alphanumeric() {
                    continue;
                }
            }

            raw_matches.push(BookMatch {
                book_number,
                book_name: book_name.clone(),
                start,
                end,
            });
        }

        // Resolve overlapping matches: prefer the longest match.
        // Sort by start position, then by length descending.
        raw_matches.sort_by(|a, b| {
            a.start
                .cmp(&b.start)
                .then_with(|| (b.end - b.start).cmp(&(a.end - a.start)))
        });

        let mut result: Vec<BookMatch> = Vec::new();
        let mut last_end: usize = 0;

        for m in raw_matches {
            if m.start >= last_end {
                last_end = m.end;
                result.push(m);
            }
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_john() {
        let matcher = BookMatcher::new();
        let matches = matcher.find_books("Jesus said in John 3:16");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].book_name, "John");
        assert_eq!(matches[0].book_number, 43);
    }

    #[test]
    fn test_find_psalm() {
        let matcher = BookMatcher::new();
        let matches = matcher.find_books("David in Psalm thirty two");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].book_name, "Psalms");
    }

    #[test]
    fn test_find_numbered_book() {
        let matcher = BookMatcher::new();
        let matches = matcher.find_books("Paul wrote in 1 Corinthians 13");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].book_name, "1 Corinthians");
    }
}
