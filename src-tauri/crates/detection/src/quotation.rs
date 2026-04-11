use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use rhema_bible::QuotationVerse;

use crate::types::{Detection, DetectionSource, VerseRef};

/// Minimum number of words in a transcript window for quotation matching.
const MIN_WINDOW_WORDS: usize = 6;

/// Minimum fraction of verse words that must appear in the transcript window.
const MIN_WORD_OVERLAP: f64 = 0.50;

/// Common words excluded from matching to prevent false positives.
const STOP_WORDS: &[&str] = &[
    "the", "and", "of", "to", "in", "a", "is", "it", "that", "was",
    "for", "his", "he", "she", "her", "they", "them", "with", "not",
    "but", "be", "from", "are", "had", "have", "has", "him", "which",
    "who", "were", "this", "all", "shall", "will", "said", "unto",
    "upon", "thy", "thee", "thou", "ye", "an", "or", "so", "as",
    "by", "on", "at", "no", "if", "my", "me", "we", "us", "do",
];

/// Maximum results to return per query.
const MAX_RESULTS: usize = 5;

/// A verse entry in the quotation index.
#[derive(Debug, Clone)]
struct IndexedVerse {
    verse_id: i64,
    book_number: i32,
    book_name: String,
    chapter: i32,
    verse: i32,
    /// Lowercase word set (used by tests).
    #[expect(dead_code, reason = "retained for test assertions and future scoring")]
    words: HashSet<String>,
    word_count: usize,
}

/// Inverted word index for fast quotation matching.
///
/// Maps each word to the list of verse IDs that contain it.
/// At query time, finds verses that share the most words with
/// the transcript window.
pub struct QuotationMatcher {
    /// All indexed verses.
    verses: Vec<IndexedVerse>,
    /// Inverted index: word → list of verse indices in `self.verses`.
    word_index: HashMap<String, Vec<usize>>,
    /// Number of verses indexed.
    verse_count: usize,
}

impl QuotationMatcher {
    /// Create an empty matcher.
    pub fn new() -> Self {
        Self {
            verses: Vec::new(),
            word_index: HashMap::new(),
            verse_count: 0,
        }
    }

    /// Build the index from verse data.
    pub fn build(verses: Vec<QuotationVerse>) -> Self {
        let mut indexed = Vec::with_capacity(verses.len());
        let mut word_index: HashMap<String, Vec<usize>> = HashMap::new();

        for v in verses {
            let words = text_to_words(&v.text);
            let word_count = words.len();

            if word_count < 3 {
                continue; // Skip very short verses
            }

            let idx = indexed.len();
            for word in &words {
                word_index.entry(word.clone()).or_default().push(idx);
            }

            indexed.push(IndexedVerse {
                verse_id: v.id,
                book_number: v.book_number,
                book_name: v.book_name,
                chapter: v.chapter,
                verse: v.verse,
                words,
                word_count,
            });
        }

        let verse_count = indexed.len();
        log::info!(
            "[QUOTATION] Index built: {verse_count} verses, {} unique words",
            word_index.len()
        );

        Self {
            verses: indexed,
            word_index,
            verse_count,
        }
    }

    /// Check if the index is ready (has verses loaded).
    pub fn is_ready(&self) -> bool {
        self.verse_count > 0
    }

    /// Match a transcript against the verse index.
    ///
    /// Splits the transcript into sliding windows of 6+ words and
    /// finds verses with high word overlap.
    pub fn match_transcript(&self, text: &str) -> Vec<Detection> {
        if !self.is_ready() || text.is_empty() {
            return vec![];
        }

        let words: Vec<String> = text_to_word_list(text);
        if words.len() < MIN_WINDOW_WORDS {
            return vec![];
        }

        // Sliding windows of different sizes
        let mut candidates: HashMap<usize, f64> = HashMap::new();

        for window_size in [words.len(), words.len().min(15), words.len().min(10)] {
            if window_size < MIN_WINDOW_WORDS {
                continue;
            }

            for start in 0..=(words.len().saturating_sub(window_size)) {
                let window = &words[start..start + window_size];
                let window_set: HashSet<&String> = window.iter().collect();

                // Find candidate verses using the inverted index
                let mut verse_hits: HashMap<usize, usize> = HashMap::new();
                for word in &window_set {
                    if let Some(verse_indices) = self.word_index.get(*word) {
                        for &idx in verse_indices {
                            *verse_hits.entry(idx).or_insert(0) += 1;
                        }
                    }
                }

                // Score candidates by word overlap
                for (idx, hit_count) in verse_hits {
                    let verse = &self.verses[idx];
                    #[expect(clippy::cast_precision_loss, reason = "word counts are small enough for f64 precision")]
                    let overlap = hit_count as f64 / verse.word_count as f64;
                    if overlap >= MIN_WORD_OVERLAP {
                        let existing = candidates.entry(idx).or_insert(0.0);
                        if overlap > *existing {
                            *existing = overlap;
                        }
                    }
                }
            }
        }

        // Sort by overlap and take top results
        let mut results: Vec<(usize, f64)> = candidates.into_iter().collect();
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(MAX_RESULTS);

        #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        results
            .into_iter()
            .map(|(idx, overlap)| {
                let verse = &self.verses[idx];
                // Scale overlap to confidence range 0.75-0.95
                let confidence = 0.75 + (overlap - MIN_WORD_OVERLAP) * 0.40;
                let confidence = confidence.min(0.95);

                Detection {
                    verse_ref: VerseRef {
                        book_number: verse.book_number,
                        book_name: verse.book_name.clone(),
                        chapter: verse.chapter,
                        verse_start: verse.verse,
                        verse_end: None,
                    },
                    verse_id: Some(verse.verse_id),
                    confidence,
                    source: DetectionSource::QuotationMatch { similarity: overlap },
                    transcript_snippet: text.to_string(),
                    detected_at: now,
                }
            })
            .collect()
    }
}

impl Default for QuotationMatcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Check if a word is a stop word.
fn is_stop_word(word: &str) -> bool {
    STOP_WORDS.contains(&word)
}

/// Convert text to a set of lowercase words, excluding stop words.
fn text_to_words(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .map(|w| {
            w.to_lowercase()
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'')
                .collect::<String>()
        })
        .filter(|w| w.len() >= 2 && !is_stop_word(w))
        .collect()
}

/// Convert text to a list of lowercase words, excluding stop words.
fn text_to_word_list(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| {
            w.to_lowercase()
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'')
                .collect::<String>()
        })
        .filter(|w| w.len() >= 2 && !is_stop_word(w))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_verses() -> Vec<QuotationVerse> {
        vec![
            QuotationVerse {
                id: 1001, book_number: 43, book_name: "John".to_string(), chapter: 3, verse: 16,
                text: "For God so loved the world that he gave his only begotten Son that whosoever believeth in him should not perish but have everlasting life".to_string(),
            },
            QuotationVerse {
                id: 1002, book_number: 45, book_name: "Romans".to_string(), chapter: 8, verse: 28,
                text: "And we know that all things work together for good to them that love God to them who are the called according to his purpose".to_string(),
            },
            QuotationVerse {
                id: 1003, book_number: 23, book_name: "Isaiah".to_string(), chapter: 40, verse: 31,
                text: "But they that wait upon the Lord shall renew their strength they shall mount up with wings as eagles they shall run and not be weary and they shall walk and not faint".to_string(),
            },
        ]
    }

    #[test]
    fn test_build_index() {
        let matcher = QuotationMatcher::build(sample_verses());
        assert!(matcher.is_ready());
        assert_eq!(matcher.verse_count, 3);
    }

    #[test]
    fn test_match_john_316() {
        let matcher = QuotationMatcher::build(sample_verses());
        let results = matcher.match_transcript(
            "For God so loved the world that he gave his only begotten Son"
        );
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "John");
        assert_eq!(results[0].verse_ref.chapter, 3);
        assert_eq!(results[0].verse_ref.verse_start, 16);
    }

    #[test]
    fn test_match_isaiah_40_31() {
        let matcher = QuotationMatcher::build(sample_verses());
        let results = matcher.match_transcript(
            "they that wait upon the Lord shall renew their strength they shall mount up with wings as eagles"
        );
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Isaiah");
        assert_eq!(results[0].verse_ref.chapter, 40);
    }

    #[test]
    fn test_short_text_ignored() {
        let matcher = QuotationMatcher::build(sample_verses());
        let results = matcher.match_transcript("hello world");
        assert!(results.is_empty());
    }

    #[test]
    fn test_no_match() {
        let matcher = QuotationMatcher::build(sample_verses());
        let results = matcher.match_transcript(
            "the weather is nice today and I went to the store to buy groceries"
        );
        assert!(results.is_empty());
    }

    #[test]
    fn test_empty_index() {
        let matcher = QuotationMatcher::new();
        assert!(!matcher.is_ready());
        let results = matcher.match_transcript("For God so loved the world");
        assert!(results.is_empty());
    }
}
