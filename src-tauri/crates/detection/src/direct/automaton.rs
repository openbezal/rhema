use aho_corasick::{AhoCorasick, MatchKind};

use super::books::{BookInfo, BOOKS};

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

/// Whether a book pattern is safe to match against speech.
///
/// Two-letter abbreviations ("Is", "So", "Am", "Ac", "Ho", "Na") are a
/// *written* citation convention. In a transcript they collide with ordinary
/// English words: "is" matched Isaiah and put Isaiah 2:8 on air for "our text
/// is Ephesians 2:8", and poisoned the context book so a later "verse sixteen"
/// resolved to Isaiah 1:16 over the operator's manual selection (issue #152).
/// Nobody speaks these aloud, so they cost nothing and cause everything.
///
/// Digit-bearing forms like "1 Sa" keep working — the number disambiguates them.
fn is_speech_safe(pattern: &str) -> bool {
    pattern.chars().any(|c| c.is_ascii_digit()) || pattern.chars().count() > 2
}

impl BookMatcher {
    /// Build the automaton from all book names, abbreviations, and aliases.
    pub fn new() -> Self {
        let mut patterns: Vec<String> = Vec::new();
        let mut pattern_map: Vec<(i32, String)> = Vec::new();

        let mut add = |pattern: String, book: &BookInfo| {
            if !is_speech_safe(&pattern) {
                return;
            }
            patterns.push(pattern);
            pattern_map.push((book.number, book.name.to_string()));
        };

        for book in BOOKS {
            // Add the canonical name
            add(book.name.to_lowercase(), book);

            // Add the abbreviation (if different from name)
            let abbr_lower = book.abbreviation.to_lowercase();
            if abbr_lower != book.name.to_lowercase() {
                add(abbr_lower, book);
            }

            // Add all aliases
            for alias in book.aliases {
                let alias_lower = alias.to_lowercase();
                // Avoid duplicates with name and abbreviation
                if alias_lower != book.name.to_lowercase()
                    && alias_lower != book.abbreviation.to_lowercase()
                {
                    add(alias_lower, book);
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

            // Check word boundary at start. An apostrophe is word-internal:
            // without this, "we're" matches the Revelation alias "Re".
            if start > 0 {
                let prev = text_bytes[start - 1];
                if prev.is_ascii_alphanumeric() || prev == b'\'' {
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

    #[test]
    fn two_letter_abbreviations_do_not_match_english_words() {
        // Every one of these is a real book alias that is also a common word:
        // Is/Isaiah, So/Song, Am/Amos, Ac/Acts, Na/Nahum, Ho/Hosea, Da/Daniel,
        // Ge/Genesis, Le/Leviticus, Ne/Nehemiah, Re/Revelation, Ob/Obadiah.
        let matcher = BookMatcher::new();
        let sentences = [
            "our text this morning is Ephesians 2:8",
            "he hath given again that which is lawful and right",
            "so am I to go on, or no",
            "he did not do anything, ac we all know",
            "na na na, that is not how it goes",
            "the ho ho ho of it all",
        ];
        for sentence in sentences {
            let books: Vec<i32> = matcher
                .find_books(sentence)
                .iter()
                .map(|m| m.book_number)
                .collect();
            let unexpected: Vec<i32> = books.iter().copied().filter(|&b| b != 49).collect();
            assert!(
                unexpected.is_empty(),
                "{sentence:?} matched unexpected books {unexpected:?}"
            );
        }
    }

    #[test]
    fn full_book_names_and_long_abbreviations_still_match() {
        let matcher = BookMatcher::new();
        for (text, expected) in [
            ("Isaiah 1:16", 23),
            ("Isa 1:16", 23),
            ("turn to Song of Solomon 2", 22),
            ("Amos chapter 5", 30),
            ("the book of Acts 2:38", 44),
            ("Hosea 6:6", 28),
            ("Genesis 1:1", 1),
        ] {
            let books: Vec<i32> = matcher
                .find_books(text)
                .iter()
                .map(|m| m.book_number)
                .collect();
            assert!(
                books.contains(&expected),
                "{text:?} should match book {expected}, got {books:?}"
            );
        }
    }

    #[test]
    fn digit_prefixed_short_aliases_survive() {
        // "1 Sa" is unambiguous because of the number, unlike a bare "Sa".
        let matcher = BookMatcher::new();
        let books: Vec<i32> = matcher
            .find_books("1 Sa 3:10")
            .iter()
            .map(|m| m.book_number)
            .collect();
        assert!(books.contains(&9), "expected 1 Samuel, got {books:?}");
    }
}
