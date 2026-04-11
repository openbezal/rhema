use std::collections::HashSet;
use std::time::Instant;
use std::sync::Arc;
use serde::Serialize;
use rhema_core::{BookId, ChapterNumber, VerseNumber, InternalEvent};

const READING_MODE_TIMEOUT_MS: u128 = 180_000;
const MIN_WORD_OVERLAP: f64 = 0.40;

/// Minimalist abstraction for calculating word overlap between text segments.
pub struct OverlapScorer;

impl OverlapScorer {
    /// Calculate similarity between a transcript word-set and a verse word-set.
    pub fn score(transcript: &HashSet<String>, verse: &HashSet<String>, total: usize) -> f64 {
        if total == 0 { return 0.0; }
        verse.intersection(transcript).count() as f64 / total as f64
    }

    /// Convert text to a normalized set of words.
    pub fn tokenize(text: &str) -> HashSet<String> {
        text.split_whitespace()
            .map(|w| w.to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '\'').collect::<String>())
            .filter(|w| w.len() >= 2)
            .collect()
    }
}

/// A verse loaded into memory for efficient matching.
#[derive(Debug, Clone)]
struct LoadedVerse {
    verse_number: VerseNumber,
    text: Arc<str>,
    words: HashSet<String>,
    word_count: usize,
}

/// Result when reading mode advances to a new verse.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReadingAdvance {
    pub book_number: BookId,
    pub book_name: Arc<str>,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub verse_text: Arc<str>,
    pub reference: Arc<str>,
    pub confidence: f64,
}

/// A lean orchestrator for the reading position.
pub struct ReadingMode {
    active: bool,
    book_id: BookId,
    book_name: Arc<str>,
    chapter: ChapterNumber,
    index: usize,
    verses: Vec<LoadedVerse>,
    last_match: Instant,
    last_emitted: Option<usize>,
    buffer: String,
}

impl ReadingMode {
    pub fn new() -> Self {
        Self {
            active: false,
            book_id: BookId(0),
            book_name: Option::<&str>::None.map(Arc::from).unwrap_or_else(|| Arc::from("")),
            chapter: ChapterNumber(0),
            index: 0,
            verses: Vec::new(),
            last_match: Instant::now(),
            last_emitted: None,
            buffer: String::new(),
        }
    }

    pub fn start(&mut self, book_id: BookId, name: &str, ch: ChapterNumber, start: VerseNumber, data: Vec<(VerseNumber, String)>) {
        self.verses = data.into_iter()
            .filter(|(v, _)| *v >= start)
            .map(|(v, text)| {
                let words = OverlapScorer::tokenize(&text);
                let word_count = words.len();
                LoadedVerse { verse_number: v, text: Arc::from(text), words, word_count }
            }).collect();

        if !self.verses.is_empty() {
            self.active = true;
            self.book_id = book_id;
            self.book_name = Arc::from(name);
            self.chapter = ch;
            self.index = 0;
            self.last_match = Instant::now();
            self.last_emitted = None;
            self.buffer.clear();
        }
    }

    pub fn deactivate(&mut self) { self.active = false; self.verses.clear(); }
    pub fn is_active(&self) -> bool { self.active }
    pub fn has_verses(&self) -> bool { !self.verses.is_empty() }
    pub fn current_book(&self) -> BookId { self.book_id }
    pub fn current_chapter(&self) -> ChapterNumber { self.chapter }
    pub fn current_verse(&self) -> Option<VerseNumber> {
        if self.active { self.verses.get(self.index).map(|v| v.verse_number) } else { None }
    }

    pub fn check_transcript(&mut self, text: &str) -> Option<ReadingAdvance> {
        if !self.has_verses() { return None; }
        
        // Timeout handling (Pause but retain verses)
        if self.last_match.elapsed().as_millis() > READING_MODE_TIMEOUT_MS {
             self.active = false;
        }

        // Command handling (jump to verse N, next, previous)
        if let Some(advance) = self.handle_commands(text) {
            self.active = true;
            return Some(advance);
        }

        if !self.active { return None; }

        if !self.buffer.is_empty() { self.buffer.push(' '); }
        self.buffer.push_str(text);

        let ws = OverlapScorer::tokenize(&self.buffer);
        
        // Check current, next, and skip-next (cascading match)
        for offset in 0..=2 {
            let target_idx = self.index + offset;
            if let Some(v) = self.verses.get(target_idx) {
                if OverlapScorer::score(&ws, &v.words, v.word_count) >= MIN_WORD_OVERLAP {
                    self.last_match = Instant::now();
                    if self.last_emitted != Some(target_idx) {
                        return self.advance_to(target_idx);
                    }
                    // Current verse matches but already emitted; continue checking for next verse
                    continue;
                }
            }
        }
        None
    }

    fn handle_commands(&mut self, text: &str) -> Option<ReadingAdvance> {
        let t = text.to_lowercase();
        let trimmed = t.trim().trim_end_matches('.');
        
        let target_idx = match trimmed {
            "next" | "next verse" => Some(self.index + 1),
            "previous" | "previous verse" | "go back" => if self.index > 0 { Some(self.index - 1) } else { None },
            _ => self.extract_verse_idx(trimmed),
        };

        if let Some(idx) = target_idx {
            if idx < self.verses.len() { return self.advance_to(idx); }
        }
        None
    }

    fn extract_verse_idx(&self, text: &str) -> Option<usize> {
        let num = if let Some(rest) = text.strip_prefix("verse ") { rest.parse::<u16>().ok() } 
                  else { text.parse::<u16>().ok() }?;
        self.verses.iter().position(|v| v.verse_number == VerseNumber(num))
    }

    fn advance_to(&mut self, idx: usize) -> Option<ReadingAdvance> {
        let v = self.verses.get(idx)?;
        let num = v.verse_number;
        let text = v.text.clone();
        
        self.index = idx;
        self.last_match = Instant::now();
        self.last_emitted = Some(idx);
        self.buffer.clear();

        let reference: Arc<str> = Arc::from(format!("{} {}:{}", self.book_name, self.chapter, num).as_str());
        InternalEvent::ReadingAdvance { book_id: self.book_id, chapter: self.chapter, verse: num, reference: reference.to_string() }.emit();

        Some(ReadingAdvance {
            book_number: self.book_id, book_name: self.book_name.clone(), chapter: self.chapter,
            verse: num, verse_text: text, reference, confidence: 1.0,
        })
    }
}

impl Default for ReadingMode { fn default() -> Self { Self::new() } }
#[cfg(test)]
mod tests {
    use super::*;
    use rhema_core::{BookId, ChapterNumber, VerseNumber};

    fn sample_verses() -> Vec<(VerseNumber, String)> {
        vec![
            (VerseNumber(1), "In the beginning God created the heavens and the earth".to_string()),
            (VerseNumber(2), "The earth was without form and void and darkness was on the face of the deep".to_string()),
            (VerseNumber(3), "Then God said let there be light and there was light".to_string()),
        ]
    }

    #[test]
    fn test_overlap_scorer() {
        let t = OverlapScorer::tokenize("God said let there be light");
        let v = OverlapScorer::tokenize("Then God said let there be light and there was light");
        
        let score = OverlapScorer::score(&t, &v, v.len());
        // v has 11 words: then, god, said, let, there, be, light, and, there, was, light
        // Uniquely (normalized): then, god, said, let, there, be, light, and, was (9 total)
        // Intersection: god, said, let, there, be, light (6 words)
        // Score: 6 / 9 = 0.66
        assert!(score > 0.60);
    }

    #[test]
    fn test_reading_mode_advance() {
        let mut rm = ReadingMode::new();
        rm.start(
            BookId(1),
            "Genesis",
            ChapterNumber(1),
            VerseNumber(1),
            sample_verses(),
        );

        // Verse 1 matches
        let adv = rm.check_transcript("In the beginning God created").unwrap();
        assert_eq!(adv.verse, VerseNumber(1));
        assert_eq!(adv.confidence, 1.0);

        // Advance to verse 2
        let adv2 = rm.check_transcript("The earth was without form").unwrap();
        assert_eq!(adv2.verse, VerseNumber(2));
        assert_eq!(adv2.confidence, 1.0);

        // Repeat verse 2 (should not emit again immediately unless threshold met, 
        // but our implementation emits on transition).
        assert!(rm.check_transcript("The earth was without form").is_none());

        // Skip to verse 3
        let adv3 = rm.check_transcript("let there be light").unwrap();
        assert_eq!(adv3.verse, VerseNumber(3));
    }

    #[test]
    fn test_reading_mode_timeout() {
        let mut rm = ReadingMode::new();
        rm.start(
            BookId(1),
            "Genesis",
            ChapterNumber(1),
            VerseNumber(1),
            sample_verses(),
        );

        // Manually expire context
        rm.last_match = Instant::now() - std::time::Duration::from_secs(200);
        
        // Should return None because it timed out
        assert!(rm.check_transcript("In the beginning").is_none());
    }
}
