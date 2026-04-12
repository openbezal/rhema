use std::collections::HashSet;
use std::time::Instant;

use serde::Serialize;

use crate::direct::parser::parse_spoken_number;

/// Timeout: pause reading mode after 3 minutes of no verse matches.
/// Context is maintained for ~3 minutes. Verses stay loaded for re-activation.
const READING_MODE_TIMEOUT_MS: u128 = 180_000;

/// Minimum word overlap ratio to consider a transcript matching a verse.
const MIN_WORD_OVERLAP: f64 = 0.40;

/// A verse loaded for reading mode tracking.
#[derive(Debug, Clone)]
struct LoadedVerse {
    verse_number: i32,
    text: String,
    /// Pre-computed lowercase word set for fast matching.
    words: HashSet<String>,
    word_count: usize,
}

/// Result when reading mode advances to a new verse.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReadingAdvance {
    pub book_number: i32,
    pub book_name: String,
    pub chapter: i32,
    pub verse: i32,
    pub verse_text: String,
    pub reference: String,
    pub confidence: f64,
}

/// Signal that reading mode wants to change to a different chapter.
/// The caller must load the new chapter from the database and call `start()`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChapterChange {
    pub book_number: i32,
    pub book_name: String,
    pub new_chapter: i32,
}

/// Tracks the current reading position and matches transcripts against
/// expected verse text to auto-advance through a passage.
///
/// Activated when direct detection catches a verse reference. Pre-loads
/// the remaining verses in the chapter. On each transcript, compares
/// word overlap against the current and next verse to detect advancement.
pub struct ReadingMode {
    active: bool,
    book_number: i32,
    book_name: String,
    chapter: i32,
    /// Index into `verses` for the current verse being read.
    current_index: usize,
    /// All verses from the starting verse to end of chapter.
    verses: Vec<LoadedVerse>,
    /// Last time a verse match was found.
    last_match_time: Instant,
    /// Accumulated transcript text since last advance (for multi-fragment matching).
    accumulated_text: String,
}

impl ReadingMode {
    /// Create an inactive reading mode instance.
    pub fn new() -> Self {
        Self {
            active: false,
            book_number: 0,
            book_name: String::new(),
            chapter: 0,
            current_index: 0,
            verses: Vec::new(),
            last_match_time: Instant::now(),
            accumulated_text: String::new(),
        }
    }

    /// Activate reading mode starting from the given verse.
    ///
    /// `verses` should be `(verse_number, verse_text)` pairs for all verses
    /// from the starting verse to the end of the chapter.
    pub fn start(
        &mut self,
        book_number: i32,
        book_name: &str,
        chapter: i32,
        start_verse: i32,
        verses: Vec<(i32, String)>,
    ) {
        // Load ALL chapter verses so "verse N" can navigate backward too.
        let loaded: Vec<LoadedVerse> = verses
            .into_iter()
            .map(|(v, text)| {
                let words = text_to_word_set(&text);
                let word_count = words.len();
                LoadedVerse {
                    verse_number: v,
                    text,
                    words,
                    word_count,
                }
            })
            .collect();

        if loaded.is_empty() {
            log::warn!("[READING] No verses loaded for {book_name} {chapter}:{start_verse}");
            return;
        }

        // Position cursor at start_verse; fall back to first verse.
        let start_index = loaded
            .iter()
            .position(|v| v.verse_number == start_verse)
            .unwrap_or(0);

        log::info!(
            "[READING] Started: {book_name} {chapter}:{start_verse} ({} verses loaded)",
            loaded.len()
        );

        self.active = true;
        self.book_number = book_number;
        self.book_name = book_name.to_string();
        self.chapter = chapter;
        self.current_index = start_index;
        self.verses = loaded;
        self.last_match_time = Instant::now();
        self.accumulated_text.clear();
    }

    /// Check if reading mode is currently active.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Check if verses are still loaded (paused but resumable).
    pub fn has_verses(&self) -> bool {
        !self.verses.is_empty()
    }

    /// Resume from the current position (re-activate after pause/toggle).
    pub fn resume(&mut self) {
        if !self.verses.is_empty() {
            self.active = true;
            self.last_match_time = Instant::now();
            let verse = self.verses.get(self.current_index).map_or(0, |v| v.verse_number);
            log::info!("[READING] Resumed at: {} {}:{verse}", self.book_name, self.chapter);
        }
    }

    /// Get the book number being tracked.
    pub fn current_book(&self) -> i32 {
        self.book_number
    }

    /// Get the chapter being tracked.
    pub fn current_chapter(&self) -> i32 {
        self.chapter
    }

    /// Get the book name being tracked.
    pub fn current_book_name(&self) -> &str {
        &self.book_name
    }

    /// Get the current verse number being tracked.
    pub fn current_verse(&self) -> Option<i32> {
        if self.active {
            self.verses.get(self.current_index).map(|v| v.verse_number)
        } else {
            None
        }
    }

    /// Fully deactivate reading mode and clear all loaded verses.
    /// Called when the user turns the toggle OFF.
    pub fn deactivate(&mut self) {
        if self.active || !self.verses.is_empty() {
            log::info!("[READING] Deactivated (verses cleared)");
        }
        self.active = false;
        self.verses.clear();
        self.accumulated_text.clear();
    }

    /// Check if the transcript contains a chapter navigation command.
    ///
    /// Recognises "chapter N", "next chapter", and "previous chapter" anywhere
    /// in the text. Returns `Some(ChapterChange)` when a different chapter is
    /// requested, `None` otherwise.
    pub fn check_chapter_command(&self, text: &str) -> Option<ChapterChange> {
        if self.verses.is_empty() {
            return None;
        }

        let lower = text.to_lowercase();
        let trimmed = lower.trim();

        // "next chapter"
        if trimmed == "next chapter" || trimmed == "next chapter." {
            let new_chapter = self.chapter + 1;
            log::info!("[READING] 'Next chapter' command detected → chapter {new_chapter}");
            return Some(ChapterChange {
                book_number: self.book_number,
                book_name: self.book_name.clone(),
                new_chapter,
            });
        }

        // "previous chapter"
        if trimmed == "previous chapter" || trimmed == "previous chapter." {
            if self.chapter > 1 {
                let new_chapter = self.chapter - 1;
                log::info!("[READING] 'Previous chapter' command detected → chapter {new_chapter}");
                return Some(ChapterChange {
                    book_number: self.book_number,
                    book_name: self.book_name.clone(),
                    new_chapter,
                });
            }
            return None;
        }

        // "chapter N" anywhere in text (e.g., "let's go to chapter seven")
        let chapter_num = extract_chapter_number(trimmed)?;

        if chapter_num == self.chapter {
            return None;
        }

        log::info!("[READING] Chapter change command detected: chapter {chapter_num}");
        Some(ChapterChange {
            book_number: self.book_number,
            book_name: self.book_name.clone(),
            new_chapter: chapter_num,
        })
    }

    /// Process a transcript fragment and check if the reader has advanced.
    ///
    /// Returns `Some(ReadingAdvance)` if the reader has moved to a new verse.
    /// Returns `None` if still on the current verse or no match found.
    ///
    /// Automatically deactivates after timeout.
    pub fn check_transcript(&mut self, text: &str) -> Option<ReadingAdvance> {
        if !self.active || self.verses.is_empty() {
            return None;
        }

        // Check timeout — but don't clear verses, just pause.
        // This allows "verse N" references to re-activate.
        if self.last_match_time.elapsed().as_millis() > READING_MODE_TIMEOUT_MS
            && self.active
        {
            log::info!("[READING] Timeout — pausing (toggle still on, verses retained)");
            self.active = false;
        }

        // Check for explicit verse number references like "verse three", "verse 4".
        // This works even when paused (timed out) — it re-activates reading mode.
        if !self.verses.is_empty() {
            if let Some(advance) = self.check_verse_number_reference(text) {
                self.active = true; // Re-activate if paused
                return Some(advance);
            }
        }

        if !self.active {
            return None;
        }

        // Accumulate text for multi-fragment matching
        if !self.accumulated_text.is_empty() {
            self.accumulated_text.push(' ');
        }
        self.accumulated_text.push_str(text);

        let transcript_words = text_to_word_set(&self.accumulated_text);

        // Check current verse
        if let Some(current) = self.verses.get(self.current_index) {
            let overlap = word_overlap(&transcript_words, &current.words, current.word_count);
            if overlap >= MIN_WORD_OVERLAP {
                // Matched current verse — now check if we should advance to next
                let next_idx = self.current_index + 1;
                if next_idx < self.verses.len() {
                    let next = &self.verses[next_idx];
                    let next_overlap = word_overlap(&transcript_words, &next.words, next.word_count);

                    // If transcript also matches next verse, advance
                    if next_overlap >= MIN_WORD_OVERLAP {
                        return self.advance_to(next_idx);
                    }
                }

                // Still on current verse, reset match timer
                self.last_match_time = Instant::now();
                return None;
            }
        }

        // Check next verse (speaker may have moved ahead without us catching current)
        let next_idx = self.current_index + 1;
        if next_idx < self.verses.len() {
            let next = &self.verses[next_idx];
            let overlap = word_overlap(&transcript_words, &next.words, next.word_count);
            if overlap >= MIN_WORD_OVERLAP {
                return self.advance_to(next_idx);
            }
        }

        // Check verse after next (speaker may have skipped one)
        let skip_idx = self.current_index + 2;
        if skip_idx < self.verses.len() {
            let skip = &self.verses[skip_idx];
            let overlap = word_overlap(&transcript_words, &skip.words, skip.word_count);
            if overlap >= MIN_WORD_OVERLAP {
                return self.advance_to(skip_idx);
            }
        }

        None
    }

    /// Check if the transcript contains a verse navigation command:
    /// - "verse three", "verse 4" → jump to that verse
    /// - "next" / "next verse" → advance by 1
    /// - "previous verse" / "go back" → go back by 1
    fn check_verse_number_reference(&mut self, text: &str) -> Option<ReadingAdvance> {
        let lower = text.to_lowercase();
        let trimmed = lower.trim();

        // Check for "next" / "next verse" command
        if trimmed == "next" || trimmed == "next." || trimmed == "next verse"
            || trimmed == "next verse." {
            let next_idx = self.current_index + 1;
            if next_idx < self.verses.len() {
                log::info!("[READING] 'Next' command detected");
                return self.advance_to(next_idx);
            }
            return None;
        }

        // Check for "previous" / "go back" command
        if trimmed == "previous verse" || trimmed == "previous verse."
            || trimmed == "go back" || trimmed == "go back." {
            if self.current_index > 0 {
                let prev_idx = self.current_index - 1;
                log::info!("[READING] 'Previous' command detected");
                return self.advance_to(prev_idx);
            }
            return None;
        }

        // Strip Deepgram stutters: "verse verse four" → "verse four"
        let cleaned = trimmed
            .replace("verse verse ", "verse ")
            .replace("verses verses ", "verses ");

        // Try to extract a verse number from patterns like "verse N", "verse N."
        let verse_num = extract_verse_number(&cleaned)?;

        // Find this verse number in our loaded verses (allow forward AND backward)
        for (idx, v) in self.verses.iter().enumerate() {
            if v.verse_number == verse_num {
                log::info!("[READING] Verse number reference detected: verse {verse_num}");
                return self.advance_to(idx);
            }
        }

        None
    }

    /// Advance to a new verse index and return the advance event.
    fn advance_to(&mut self, index: usize) -> Option<ReadingAdvance> {
        let verse = self.verses.get(index)?;
        let verse_number = verse.verse_number;
        let verse_text = verse.text.clone();

        self.current_index = index;
        self.last_match_time = Instant::now();
        self.accumulated_text.clear();

        let reference = format!("{} {}:{verse_number}", self.book_name, self.chapter);
        log::info!("[READING] Advanced to: {reference}");

        Some(ReadingAdvance {
            book_number: self.book_number,
            book_name: self.book_name.clone(),
            chapter: self.chapter,
            verse: verse_number,
            verse_text,
            reference,
            confidence: 1.0, // We'll refine this later
        })
    }
}

impl Default for ReadingMode {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract a verse number from text containing "verse N" anywhere.
///
/// Matches phrases like "let's go to verse five", "give me verse 4",
/// "verse three", or bare numbers like "3.".
fn extract_verse_number(text: &str) -> Option<i32> {
    // Find "verse N" or "verses N" anywhere in the text
    for keyword in &["verse ", "verses "] {
        if let Some(pos) = text.find(keyword) {
            let rest = &text[pos + keyword.len()..];
            return parse_number_token(rest);
        }
    }

    // Keep "first N" as a prefix-only match
    if let Some(rest) = text.strip_prefix("first ") {
        return parse_number_token(rest);
    }

    // Bare number: just "3." or "3"
    let clean = text.trim_end_matches('.');
    if let Ok(n) = clean.trim().parse::<i32>() {
        if n > 0 && n <= 176 {
            return Some(n);
        }
    }

    None
}

/// Parse a number (digit or spoken word) from the start of `text`.
fn parse_number_token(text: &str) -> Option<i32> {
    let trimmed = text.trim_end_matches(['.', ',']);
    // Try digit
    let token: String = trimmed.chars().take_while(|c| c.is_alphanumeric()).collect();
    if let Ok(n) = token.parse::<i32>() {
        if n > 0 && n <= 176 {
            return Some(n);
        }
    }
    // Try spoken number
    let word: String = trimmed.chars().take_while(|c| c.is_alphabetic()).collect();
    if !word.is_empty() {
        if let Some(n) = parse_spoken_number(&word) {
            if n > 0 && n <= 176 {
                return Some(n);
            }
        }
    }
    None
}

/// Extract a chapter number from text containing "chapter N" anywhere.
fn extract_chapter_number(text: &str) -> Option<i32> {
    let pos = text.find("chapter ")?;
    let rest = &text[pos + "chapter ".len()..];
    // Reuse the same number parsing (max chapter is 150 in Psalms)
    parse_number_token(rest)
}

/// Convert text to a set of lowercase words (stripped of punctuation).
fn text_to_word_set(text: &str) -> HashSet<String> {
    text.split_whitespace()
        .map(|w| {
            w.to_lowercase()
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '\'')
                .collect::<String>()
        })
        .filter(|w| w.len() >= 2) // Skip single-char words
        .collect()
}

/// Calculate what fraction of `verse_words` appear in `transcript_words`.
fn word_overlap(
    transcript_words: &HashSet<String>,
    verse_words: &HashSet<String>,
    verse_word_count: usize,
) -> f64 {
    if verse_word_count == 0 {
        return 0.0;
    }
    let matches = verse_words.intersection(transcript_words).count();
    #[expect(clippy::cast_precision_loss, reason = "word counts are small enough for f64 precision")]
    { matches as f64 / verse_word_count as f64 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_verses() -> Vec<(i32, String)> {
        vec![
            (28, "For it seemed good to the Holy Ghost, and to us, to lay upon you no greater burden than these necessary things;".to_string()),
            (29, "That ye abstain from meats offered to idols, and from blood, and from things strangled, and from fornication: from which if ye keep yourselves, ye shall do well. Fare ye well.".to_string()),
            (30, "So when they were dismissed, they came to Antioch: and when they had gathered the multitude together, they delivered the epistle:".to_string()),
            (31, "Which when they had read, they rejoiced for the consolation.".to_string()),
        ]
    }

    #[test]
    fn test_starts_inactive() {
        let rm = ReadingMode::new();
        assert!(!rm.is_active());
        assert!(rm.current_verse().is_none());
    }

    #[test]
    fn test_start_activates() {
        let mut rm = ReadingMode::new();

        rm.start(44, "Acts", 15, 28, sample_verses());
        assert!(rm.is_active());
        assert_eq!(rm.current_verse(), Some(28));
    }

    #[test]
    fn test_advance_on_next_verse_match() {
        let mut rm = ReadingMode::new();

        rm.start(44, "Acts", 15, 28, sample_verses());

        // Feed text matching verse 28
        let r = rm.check_transcript("it seemed good to the Holy Ghost and to us to lay upon you no greater burden than these necessary things");
        // Still on verse 28 — no advance yet
        assert!(r.is_none());

        // Feed text matching verse 29
        let r = rm.check_transcript("that ye abstain from meats offered to idols and from blood and from things strangled and from fornication");
        assert!(r.is_some());
        let advance = r.unwrap();
        assert_eq!(advance.verse, 29);
        assert_eq!(advance.reference, "Acts 15:29");
    }

    #[test]
    fn test_deactivate() {
        let mut rm = ReadingMode::new();

        rm.start(44, "Acts", 15, 28, sample_verses());
        assert!(rm.is_active());
        rm.deactivate();
        assert!(!rm.is_active());
    }

    #[test]
    fn test_no_match_returns_none() {
        let mut rm = ReadingMode::new();

        rm.start(44, "Acts", 15, 28, sample_verses());

        let r = rm.check_transcript("the weather is nice today and I like coffee");
        assert!(r.is_none());
    }

    #[test]
    fn test_word_overlap_function() {
        let transcript = text_to_word_set("for it seemed good to the holy ghost");
        let verse = text_to_word_set("For it seemed good to the Holy Ghost, and to us, to lay upon you no greater burden than these necessary things;");
        let count = verse.len();
        let overlap = word_overlap(&transcript, &verse, count);
        assert!(overlap > 0.3); // At least some overlap
    }

    // --- Bug fix: extract_verse_number with prefix phrases ---

    #[test]
    fn test_extract_verse_number_with_prefix() {
        assert_eq!(extract_verse_number("let's go to verse five"), Some(5));
        assert_eq!(extract_verse_number("give me verse nine"), Some(9));
        assert_eq!(extract_verse_number("go to verse 4"), Some(4));
        assert_eq!(extract_verse_number("let's go to verse twenty"), Some(20));
    }

    #[test]
    fn test_extract_verse_number_direct() {
        assert_eq!(extract_verse_number("verse eight"), Some(8));
        assert_eq!(extract_verse_number("verse eight,"), Some(8));
        assert_eq!(extract_verse_number("verse 3"), Some(3));
        assert_eq!(extract_verse_number("verse three."), Some(3));
    }

    #[test]
    fn test_extract_verse_number_bare() {
        assert_eq!(extract_verse_number("3."), Some(3));
        assert_eq!(extract_verse_number("12"), Some(12));
    }

    #[test]
    fn test_extract_verse_number_no_match() {
        assert_eq!(extract_verse_number("hello world"), None);
        assert_eq!(extract_verse_number("the weather is nice"), None);
    }

    // --- Bug fix: all chapter verses loaded for backward navigation ---

    #[test]
    fn test_backward_verse_navigation() {
        let mut rm = ReadingMode::new();
        let verses: Vec<(i32, String)> = (1..=10)
            .map(|i| (i, format!("Verse {i} text content here.")))
            .collect();

        rm.start(1, "Genesis", 5, 6, verses);
        assert_eq!(rm.current_verse(), Some(6));

        // Navigate backward to verse 3
        let r = rm.check_transcript("verse three");
        assert!(r.is_some());
        assert_eq!(r.unwrap().verse, 3);
    }

    #[test]
    fn test_start_positions_cursor_at_start_verse() {
        let mut rm = ReadingMode::new();
        let verses: Vec<(i32, String)> = (1..=31)
            .map(|i| (i, format!("Verse {i} text.")))
            .collect();

        rm.start(44, "Acts", 15, 28, verses);
        assert_eq!(rm.current_verse(), Some(28));
    }

    // --- Bug fix: chapter navigation ---

    #[test]
    fn test_chapter_command_detected() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 5, 1, vec![(1, "In the beginning.".to_string())]);

        let result = rm.check_chapter_command("let's go to chapter seven");
        assert_eq!(
            result,
            Some(ChapterChange {
                book_number: 1,
                book_name: "Genesis".to_string(),
                new_chapter: 7,
            })
        );
    }

    #[test]
    fn test_chapter_command_with_digit() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 5, 1, vec![(1, "Text.".to_string())]);

        let result = rm.check_chapter_command("let's go to chapter 8");
        assert!(result.is_some());
        assert_eq!(result.unwrap().new_chapter, 8);
    }

    #[test]
    fn test_chapter_command_same_chapter_ignored() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 5, 1, vec![(1, "Text.".to_string())]);

        let result = rm.check_chapter_command("chapter five");
        assert_eq!(result, None);
    }

    #[test]
    fn test_chapter_command_no_verses_ignored() {
        let rm = ReadingMode::new();
        let result = rm.check_chapter_command("chapter seven");
        assert_eq!(result, None);
    }

    #[test]
    fn test_next_chapter_command() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 5, 1, vec![(1, "Text.".to_string())]);

        let result = rm.check_chapter_command("next chapter");
        assert!(result.is_some());
        assert_eq!(result.unwrap().new_chapter, 6);
    }

    #[test]
    fn test_previous_chapter_command() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 5, 1, vec![(1, "Text.".to_string())]);

        let result = rm.check_chapter_command("previous chapter");
        assert!(result.is_some());
        assert_eq!(result.unwrap().new_chapter, 4);
    }

    #[test]
    fn test_previous_chapter_at_chapter_1() {
        let mut rm = ReadingMode::new();
        rm.start(1, "Genesis", 1, 1, vec![(1, "Text.".to_string())]);

        let result = rm.check_chapter_command("previous chapter");
        assert_eq!(result, None);
    }

    #[test]
    fn test_extract_chapter_number() {
        assert_eq!(extract_chapter_number("chapter seven"), Some(7));
        assert_eq!(extract_chapter_number("chapter 8"), Some(8));
        assert_eq!(extract_chapter_number("let's go to chapter twelve"), Some(12));
        assert_eq!(extract_chapter_number("hello world"), None);
    }
}
