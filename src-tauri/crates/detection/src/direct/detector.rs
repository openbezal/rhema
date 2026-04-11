use std::collections::VecDeque;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::automaton::{BookMatch, BookMatcher};
use super::context::ReferenceContext;
use super::fuzzy;
use super::parser;
use crate::types::{Detection, DetectionSource, VerseRef};
use rhema_core::{BookId, ChapterNumber, VerseNumber};
use std::sync::Arc;

/// Translation command patterns — maps spoken phrases to translation abbreviations.
const TRANSLATION_COMMANDS: &[(&str, &str)] = &[
    // NIV
    ("give me niv", "NIV"),
    ("read in niv", "NIV"),
    ("switch to niv", "NIV"),
    ("in the niv", "NIV"),
    ("new international version", "NIV"),
    // ESV
    ("give me esv", "ESV"),
    ("read in esv", "ESV"),
    ("switch to esv", "ESV"),
    ("in the esv", "ESV"),
    ("english standard version", "ESV"),
    // NASB
    ("give me nasb", "NASB"),
    ("read in nasb", "NASB"),
    ("switch to nasb", "NASB"),
    ("in the nasb", "NASB"),
    ("new american standard", "NASB"),
    // NKJV
    ("give me nkjv", "NKJV"),
    ("read in nkjv", "NKJV"),
    ("switch to nkjv", "NKJV"),
    ("in the nkjv", "NKJV"),
    ("new king james", "NKJV"),
    // NLT
    ("give me nlt", "NLT"),
    ("read in nlt", "NLT"),
    ("switch to nlt", "NLT"),
    ("in the nlt", "NLT"),
    ("new living translation", "NLT"),
    // KJV
    ("give me kjv", "KJV"),
    ("read in kjv", "KJV"),
    ("switch to kjv", "KJV"),
    ("in the kjv", "KJV"),
    ("king james version", "KJV"),
    ("king james", "KJV"),
    // AMP
    ("give me amp", "AMP"),
    ("give me amplified", "AMP"),
    ("read in amplified", "AMP"),
    ("switch to amplified", "AMP"),
    ("amplified bible", "AMP"),
    ("amplified version", "AMP"),
];

/// Maximum chapter count per book (book_number 1-66).
/// Used to reject impossible references like "Mark 30:1" (Mark has 16 chapters).
const MAX_CHAPTERS: [i32; 67] = [
    0,  // index 0 unused
    50, // 1  Genesis
    40, // 2  Exodus
    27, // 3  Leviticus
    36, // 4  Numbers
    34, // 5  Deuteronomy
    24, // 6  Joshua
    21, // 7  Judges
    4,  // 8  Ruth
    31, // 9  1 Samuel
    24, // 10 2 Samuel
    22, // 11 1 Kings
    25, // 12 2 Kings
    29, // 13 1 Chronicles
    36, // 14 2 Chronicles
    10, // 15 Ezra
    13, // 16 Nehemiah
    10, // 17 Esther
    42, // 18 Job
    150,// 19 Psalms
    31, // 20 Proverbs
    12, // 21 Ecclesiastes
    8,  // 22 Song of Solomon
    66, // 23 Isaiah
    52, // 24 Jeremiah
    5,  // 25 Lamentations
    48, // 26 Ezekiel
    12, // 27 Daniel
    14, // 28 Hosea
    3,  // 29 Joel
    9,  // 30 Amos
    1,  // 31 Obadiah
    4,  // 32 Jonah
    7,  // 33 Micah
    3,  // 34 Nahum
    3,  // 35 Habakkuk
    3,  // 36 Zephaniah
    2,  // 37 Haggai
    14, // 38 Zechariah
    4,  // 39 Malachi
    28, // 40 Matthew
    16, // 41 Mark
    24, // 42 Luke
    21, // 43 John
    28, // 44 Acts
    16, // 45 Romans
    16, // 46 1 Corinthians
    13, // 47 2 Corinthians
    6,  // 48 Galatians
    6,  // 49 Ephesians
    4,  // 50 Philippians
    4,  // 51 Colossians
    5,  // 52 1 Thessalonians
    3,  // 53 2 Thessalonians
    6,  // 54 1 Timothy
    4,  // 55 2 Timothy
    3,  // 56 Titus
    1,  // 57 Philemon
    13, // 58 Hebrews
    5,  // 59 James
    5,  // 60 1 Peter
    3,  // 61 2 Peter
    5,  // 62 1 John
    1,  // 63 2 John
    1,  // 64 3 John
    1,  // 65 Jude
    22, // 66 Revelation
];

/// Check if a book/chapter combination is valid.
fn is_valid_reference(book_id: BookId, chapter: ChapterNumber) -> bool {
    let b_idx = book_id.0 as usize;
    if b_idx < 1 || b_idx > 66 {
        return false;
    }
    let max_ch = MAX_CHAPTERS[b_idx];
    chapter.0 >= 1 && chapter.0 <= max_ch as u16
}

/// Confidence assigned to chapter-only references (no verse specified).
/// Lower than full references (0.90+) since the user likely wants a specific verse.
const CHAPTER_ONLY_CONFIDENCE: f64 = 0.75;

/// Filler phrases commonly found in sermon transcripts that confuse detection.
const FILLER_PHRASES: &[&str] = &[
    "please open your bibles to",
    "let us turn to",
    "let's turn to",
    "go to the book of",
    "the book of",
    "book of",
    "if you turn to",
    "if you'll turn to",
    "we will be reading from",
    "we read in",
    "the bible says in",
    "it says in",
    "as we see in",
    "as written in",
    "let's go to",
    "turn in your bibles to",
    "turn in your bible to",
];

/// Strip common sermon filler phrases from transcript text.
fn clean_transcript(text: &str) -> String {
    let mut result = text.to_string();

    for phrase in FILLER_PHRASES {
        loop {
            let lower = result.to_lowercase();
            if let Some(pos) = lower.find(phrase) {
                result = format!("{}{}", &result[..pos], &result[pos + phrase.len()..]);
            } else {
                break;
            }
        }
    }

    // Handle "look at" heuristic
    loop {
        let lower = result.to_lowercase();
        if let Some(pos) = lower.find("look at") {
            let after_pos = pos + "look at".len();
            let after = &result[after_pos..];
            let trimmed = after.trim_start();
            if let Some(ch) = trimmed.chars().next() {
                if ch.is_ascii_uppercase() {
                    result = format!("{}{}", &result[..pos], &result[after_pos..]);
                    continue;
                }
            }
            break;
        } else {
            break;
        }
    }

    let mut prev_space = false;
    let collapsed: String = result
        .chars()
        .filter(|&c| {
            if c == ' ' {
                if prev_space { return false; }
                prev_space = true;
            } else {
                prev_space = false;
            }
            true
        })
        .collect();

    collapsed.trim().to_string()
}

/// How long to wait for an incomplete reference to be completed (5 seconds).
const INCOMPLETE_REF_TIMEOUT: u128 = 5000;

/// An incomplete reference waiting for verse completion.
#[derive(Debug, Clone)]
struct IncompleteRef {
    verse_ref: VerseRef,
    timestamp: Instant,
}

/// Main orchestrator for direct Bible reference detection.
pub struct DirectDetector {
    matcher: BookMatcher,
    context: ReferenceContext,
    /// Pending incomplete reference waiting for verse completion.
    incomplete: Option<IncompleteRef>,
    /// Recently detected verses for "previous verse" navigation.
    pub recent_detections: VecDeque<VerseRef>,
}

/// Phrases that indicate the user wants to go back to a previous verse.
const PREVIOUS_VERSE_PHRASES: &[&str] = &[
    "previous verse",
    "last verse",
    "that verse again",
    "go back to that verse",
    "back to that verse",
    "the same verse",
    "repeat that verse",
];

impl DirectDetector {
    pub fn new() -> Self {
        DirectDetector {
            matcher: BookMatcher::new(),
            context: ReferenceContext::new(),
            incomplete: None,
            recent_detections: VecDeque::with_capacity(5),
        }
    }

    /// Recent detections for context tracking.
    pub fn recent_detections(&self) -> &VecDeque<VerseRef> {
        &self.recent_detections
    }

    /// Check if the transcript contains a translation switching command.
    pub fn detect_translation_command(&self, text: &str) -> Option<String> {
        let lower = text.to_lowercase();

        for (pattern, abbrev) in TRANSLATION_COMMANDS {
            if lower.contains(pattern) {
                log::info!("[DET-DIRECT] Translation command detected: {}", abbrev);
                return Some(abbrev.to_string());
            }
        }

        let words: Vec<&str> = lower.split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
            .collect();

        for word in &words {
            let matched = match *word {
                "niv" => Some("NIV"),
                "esv" => Some("ESV"),
                "nasb" => Some("NASB"),
                "nkjv" => Some("NKJV"),
                "nlt" => Some("NLT"),
                "kjv" => Some("KJV"),
                "amp" => Some("AMP"),
                "amplified" => Some("AMP"),
                _ => None,
            };
            if let Some(abbrev) = matched {
                log::info!("[DET-DIRECT] Translation abbreviation detected: {}", abbrev);
                return Some(abbrev.to_string());
            }
        }

        None
    }

    /// Detect Bible references in the given transcript text.
    pub fn detect(&mut self, text: &str) -> Vec<Detection> {
        let cleaned = clean_transcript(text);
        let text = &cleaned;

        let mut detections = Vec::new();

        if let Some(prev_detection) = self.check_previous_verse_command(text) {
            detections.push(prev_detection);
            return detections;
        }

        if let Some(ref incomplete) = self.incomplete.clone() {
            let elapsed = incomplete.timestamp.elapsed().as_millis();
            if elapsed > INCOMPLETE_REF_TIMEOUT {
                let mut ref_with_verse = incomplete.verse_ref.clone();
                ref_with_verse.verse_start = VerseNumber(1);
                detections.push(self.make_direct_detection(
                    &ref_with_verse,
                    CHAPTER_ONLY_CONFIDENCE,
                    text,
                    0,
                    text.len(),
                ));
                self.push_recent(&ref_with_verse);
                self.context.update(&ref_with_verse);
                self.incomplete = None;
            } else if let Some(verse) = try_extract_verse_continuation(text) {
                let mut completed = incomplete.verse_ref.clone();
                completed.verse_start = verse;
                detections.push(self.make_direct_detection(
                    &completed,
                    self.compute_confidence(&completed, &completed),
                    text,
                    0,
                    text.len(),
                ));
                self.push_recent(&completed);
                self.context.update(&completed);
                self.incomplete = None;
                return detections;
            }
        }

        let book_matches = self.matcher.find_books(text);
        let fuzzy_matches: Vec<BookMatch>;
        let effective_matches: &[BookMatch] = if book_matches.is_empty() {
            fuzzy_matches = fuzzy::fuzzy_find_books(text)
                .into_iter()
                .map(|fm| BookMatch {
                    book_number: fm.book_number,
                    book_name: fm.book_name,
                    start: fm.start,
                    end: fm.end,
                })
                .collect();
            &fuzzy_matches
        } else {
            &book_matches
        };

        for book_match in effective_matches {
            if let Some(verse_ref) = parser::parse_reference(text, book_match) {
                let resolved = self.context.resolve(&verse_ref);

                if resolved.book_number.is_null() || resolved.chapter.is_null() {
                    self.context.update(&verse_ref);
                    continue;
                }

                if !resolved.chapter.is_null() && !is_valid_reference(resolved.book_number, resolved.chapter) {
                    continue;
                }

                if resolved.verse_start.is_null() {
                    self.incomplete = Some(IncompleteRef {
                        verse_ref: resolved.clone(),
                        timestamp: Instant::now(),
                    });
                    self.context.update(&resolved);
                    continue;
                }

                self.incomplete = None;
                let confidence = self.compute_confidence(&resolved, &verse_ref);
                let snippet = self.extract_snippet(text, book_match.start, book_match.end);

                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                let detection = Detection {
                    verse_ref: resolved.clone(),
                    verse_id: None,
                    confidence,
                    source: DetectionSource::DirectReference,
                    transcript_snippet: snippet,
                    detected_at: now,
                };

                self.push_recent(&resolved);
                detections.push(detection);
                self.context.update(&resolved);
            }
        }

        detections
    }

    fn check_previous_verse_command(&self, text: &str) -> Option<Detection> {
        let lower = text.to_lowercase();
        for phrase in PREVIOUS_VERSE_PHRASES {
            if lower.contains(phrase) {
                if let Some(prev_ref) = self.recent_detections.front() {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    return Some(Detection {
                        verse_ref: prev_ref.clone(),
                        verse_id: None,
                        confidence: 0.92,
                        source: DetectionSource::DirectReference,
                        transcript_snippet: Arc::from(text),
                        detected_at: now,
                    });
                }
            }
        }
        None
    }

    fn push_recent(&mut self, verse_ref: &VerseRef) {
        if let Some(front) = self.recent_detections.front() {
            if front.book_number == verse_ref.book_number
                && front.chapter == verse_ref.chapter
                && front.verse_start == verse_ref.verse_start
            {
                return;
            }
        }
        self.recent_detections.push_front(verse_ref.clone());
        if self.recent_detections.len() > 5 {
            self.recent_detections.pop_back();
        }
    }

    fn make_direct_detection(
        &self,
        verse_ref: &VerseRef,
        confidence: f64,
        text: &str,
        start: usize,
        end: usize,
    ) -> Detection {
        let snippet = self.extract_snippet(text, start, end.min(text.len()));
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        Detection {
            verse_ref: verse_ref.clone(),
            verse_id: None,
            confidence,
            source: DetectionSource::DirectReference,
            transcript_snippet: snippet,
            detected_at: now,
        }
    }

    fn compute_confidence(&self, original: &VerseRef, _resolved: &VerseRef) -> f64 {
        let mut confidence: f64 = 0.85;

        if original.book_number.is_null() {
            confidence -= 0.05;
        }
        if original.chapter.is_null() {
            confidence -= 0.05;
        }

        if !original.chapter.is_null() {
            confidence += 0.04;
        }
        if !original.verse_start.is_null() {
            confidence += 0.04;
        }
        if !original.book_number.is_null() {
            confidence += 0.02;
        }

        confidence.min(1.0)
    }

    fn extract_snippet(&self, text: &str, start: usize, end: usize) -> Arc<str> {
        let snippet_start = if start > 30 { start - 30 } else { 0 };
        let snippet_end = if end + 30 < text.len() {
            end + 30
        } else {
            text.len()
        };

        let snippet_start = text[snippet_start..start]
            .rfind(' ')
            .map(|p| snippet_start + p + 1)
            .unwrap_or(snippet_start);

        let snippet_end = text[end..snippet_end]
            .find(' ')
            .map(|p| {
                let after_space = end + p + 1;
                text[after_space..snippet_end]
                    .find(' ')
                    .map(|p2| after_space + p2)
                    .unwrap_or(snippet_end)
            })
            .unwrap_or(snippet_end);

        Arc::from(&text[snippet_start..snippet_end])
    }
}

impl Default for DirectDetector {
    fn default() -> Self {
        Self::new()
    }
}

fn try_extract_verse_continuation(text: &str) -> Option<VerseNumber> {
    let lower = text.to_lowercase();
    let trimmed = lower.trim();

    for prefix in &["verse ", "verses ", "and verse ", "and verses "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let num_str: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(n) = num_str.parse::<u16>() {
                if n > 0 {
                    return Some(VerseNumber(n));
                }
            }
            let word: String = rest.chars().take_while(|c| c.is_alphabetic()).collect();
            if let Some(n) = parser::parse_spoken_number(&word) {
                if n > 0 {
                    return Some(VerseNumber(n as u16));
                }
            }
        }
    }

    let num_str: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
    if num_str.len() >= 1 && num_str.len() <= 3 {
        if let Ok(n) = num_str.parse::<u16>() {
            if n > 0 && n <= 176 {
                return Some(VerseNumber(n));
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_reference() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Jesus said in John 3:16 that God loved the world");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "John");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(3));
        assert_eq!(results[0].verse_ref.verse_start, VerseNumber(16));
    }

    #[test]
    fn test_spoken_reference() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("David in Psalm thirty two verse one now says");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "Psalms");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(32));
        assert_eq!(results[0].verse_ref.verse_start, VerseNumber(1));
    }

    #[test]
    fn test_verse_range() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Let's read Romans 8:28-30 together");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "Romans");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(8));
        assert_eq!(results[0].verse_ref.verse_start, VerseNumber(28));
        assert_eq!(results[0].verse_ref.verse_end, Some(VerseNumber(30)));
    }

    #[test]
    fn test_numbered_book() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Paul wrote in 1 Corinthians 13:4 about love");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "1 Corinthians");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(13));
        assert_eq!(results[0].verse_ref.verse_start, VerseNumber(4));
    }

    #[test]
    fn test_chapter_only_held_as_incomplete() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Genesis 3 is about the fall of man");
        assert!(results.is_empty());
        assert!(detector.incomplete.is_some());
    }

    #[test]
    fn test_incomplete_ref_completed_by_verse() {
        let mut detector = DirectDetector::new();
        let _ = detector.detect("Genesis 3");
        let results = detector.detect("verse 15");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "Genesis");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(3));
        assert_eq!(results[0].verse_ref.verse_start, VerseNumber(15));
    }

    #[test]
    fn test_previous_verse_command() {
        let mut detector = DirectDetector::new();
        let _ = detector.detect("John 3:16");
        let results = detector.detect("can you show me the last verse");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name.as_ref(), "John");
        assert_eq!(results[0].verse_ref.chapter, ChapterNumber(3));
    }
}
