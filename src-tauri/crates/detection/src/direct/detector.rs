use std::collections::VecDeque;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::automaton::{BookMatch, BookMatcher};
use super::context::ReferenceContext;
use super::fuzzy;
use super::parser;
use crate::types::{Detection, DetectionSource, VerseRef};

/// Translation command patterns — maps spoken phrases to translation abbreviations.
const TRANSLATION_COMMANDS: &[(&str, &str)] = &[
    // NIV
    ("give me niv", "NIV"),
    ("read in niv", "NIV"),
    ("switch to niv", "NIV"),
    ("in the niv", "NIV"),
    ("can i have it in niv", "NIV"),
    ("can i have that in niv", "NIV"),
    ("show me niv", "NIV"),
    ("new international version", "NIV"),
    ("in new international", "NIV"),
    // ESV
    ("give me esv", "ESV"),
    ("read in esv", "ESV"),
    ("switch to esv", "ESV"),
    ("in the esv", "ESV"),
    ("can i have it in esv", "ESV"),
    ("can i have that in esv", "ESV"),
    ("show me esv", "ESV"),
    ("english standard version", "ESV"),
    ("in english standard", "ESV"),
    // NASB
    ("give me nasb", "NASB"),
    ("read in nasb", "NASB"),
    ("switch to nasb", "NASB"),
    ("in the nasb", "NASB"),
    ("can i have it in nasb", "NASB"),
    ("can i have that in nasb", "NASB"),
    ("show me nasb", "NASB"),
    ("new american standard", "NASB"),
    ("in new american", "NASB"),
    // NKJV
    ("give me nkjv", "NKJV"),
    ("read in nkjv", "NKJV"),
    ("switch to nkjv", "NKJV"),
    ("in the nkjv", "NKJV"),
    ("can i have it in nkjv", "NKJV"),
    ("can i have that in nkjv", "NKJV"),
    ("show me nkjv", "NKJV"),
    ("new king james", "NKJV"),
    ("in new king james", "NKJV"),
    // NLT
    ("give me nlt", "NLT"),
    ("read in nlt", "NLT"),
    ("switch to nlt", "NLT"),
    ("in the nlt", "NLT"),
    ("can i have it in nlt", "NLT"),
    ("can i have that in nlt", "NLT"),
    ("show me nlt", "NLT"),
    ("new living translation", "NLT"),
    ("in new living", "NLT"),
    // KJV
    ("give me kjv", "KJV"),
    ("read in kjv", "KJV"),
    ("switch to kjv", "KJV"),
    ("in the kjv", "KJV"),
    ("can i have it in kjv", "KJV"),
    ("can i have that in kjv", "KJV"),
    ("show me kjv", "KJV"),
    ("king james version", "KJV"),
    ("king james", "KJV"),
    ("in king james", "KJV"),
    // AMP
    ("give me amp", "AMP"),
    ("give me amplified", "AMP"),
    ("read in amplified", "AMP"),
    ("switch to amplified", "AMP"),
    ("in the amplified", "AMP"),
    ("can i have it in amplified", "AMP"),
    ("can i have that in amplified", "AMP"),
    ("can i have it in amp", "AMP"),
    ("can i have that in amp", "AMP"),
    ("show me amplified", "AMP"),
    ("show me amp", "AMP"),
    ("amplified bible", "AMP"),
    ("amplified version", "AMP"),
    ("amplified translation", "AMP"),
    ("in amplified version", "AMP"),
    ("in amplified translation", "AMP"),
    // SpaRV (Spanish - Reina-Valera 1909)
    ("give me reina valera", "SpaRV"),
    ("read in reina valera", "SpaRV"),
    ("switch to reina valera", "SpaRV"),
    ("in reina valera", "SpaRV"),
    ("can i have it in reina valera", "SpaRV"),
    ("can i have that in reina valera", "SpaRV"),
    ("show me reina valera", "SpaRV"),
    ("give me spanish", "SpaRV"),
    ("read in spanish", "SpaRV"),
    ("switch to spanish", "SpaRV"),
    ("in spanish", "SpaRV"),
    ("can i have it in spanish", "SpaRV"),
    ("can i have that in spanish", "SpaRV"),
    ("spanish version", "SpaRV"),
    ("spanish translation", "SpaRV"),
    // FreJND (French - J.N. Darby)
    ("give me french", "FreJND"),
    ("read in french", "FreJND"),
    ("switch to french", "FreJND"),
    ("in french", "FreJND"),
    ("can i have it in french", "FreJND"),
    ("can i have that in french", "FreJND"),
    ("show me french", "FreJND"),
    ("french version", "FreJND"),
    ("french translation", "FreJND"),
    ("darby french", "FreJND"),
    // PorBLivre (Portuguese - Biblia Livre)
    ("give me portuguese", "PorBLivre"),
    ("read in portuguese", "PorBLivre"),
    ("switch to portuguese", "PorBLivre"),
    ("in portuguese", "PorBLivre"),
    ("can i have it in portuguese", "PorBLivre"),
    ("can i have that in portuguese", "PorBLivre"),
    ("show me portuguese", "PorBLivre"),
    ("portuguese version", "PorBLivre"),
    ("portuguese translation", "PorBLivre"),
    ("biblia livre", "PorBLivre"),
    // MSG (The Message)
    ("give me message", "MSG"),
    ("give me the message", "MSG"),
    ("read in message", "MSG"),
    ("read in the message", "MSG"),
    ("switch to message", "MSG"),
    ("switch to the message", "MSG"),
    ("in the message", "MSG"),
    ("can i have it in message", "MSG"),
    ("can i have that in message", "MSG"),
    ("can i have it in the message", "MSG"),
    ("can i have that in the message", "MSG"),
    ("show me message", "MSG"),
    ("show me the message", "MSG"),
    ("message version", "MSG"),
    ("message translation", "MSG"),
    ("message bible", "MSG"),
    // HCSB (Holman Christian Standard Bible) - must come before CSB to avoid substring matches
    ("give me hcsb", "HCSB"),
    ("read in hcsb", "HCSB"),
    ("switch to hcsb", "HCSB"),
    ("in the hcsb", "HCSB"),
    ("can i have it in hcsb", "HCSB"),
    ("can i have that in hcsb", "HCSB"),
    ("show me hcsb", "HCSB"),
    ("holman christian standard", "HCSB"),
    ("holman christian", "HCSB"),
    ("in holman christian", "HCSB"),
    // CSB (Christian Standard Bible)
    ("give me csb", "CSB"),
    ("read in csb", "CSB"),
    ("switch to csb", "CSB"),
    ("in the csb", "CSB"),
    ("can i have it in csb", "CSB"),
    ("can i have that in csb", "CSB"),
    ("show me csb", "CSB"),
    ("christian standard bible", "CSB"),
    ("christian standard", "CSB"),
    ("in christian standard", "CSB"),
    // NRSV (New Revised Standard Version) - must come before RSV to avoid substring matches
    ("give me nrsv", "NRSV"),
    ("read in nrsv", "NRSV"),
    ("switch to nrsv", "NRSV"),
    ("in the nrsv", "NRSV"),
    ("can i have it in nrsv", "NRSV"),
    ("can i have that in nrsv", "NRSV"),
    ("show me nrsv", "NRSV"),
    ("new revised standard version", "NRSV"),
    ("new revised standard", "NRSV"),
    ("in new revised standard", "NRSV"),
    // RSV (Revised Standard Version)
    ("give me rsv", "RSV"),
    ("read in rsv", "RSV"),
    ("switch to rsv", "RSV"),
    ("in the rsv", "RSV"),
    ("can i have it in rsv", "RSV"),
    ("can i have that in rsv", "RSV"),
    ("show me rsv", "RSV"),
    ("revised standard version", "RSV"),
    ("revised standard", "RSV"),
    ("in revised standard", "RSV"),
    // NET (New English Translation)
    ("give me net", "NET"),
    ("read in net", "NET"),
    ("switch to net", "NET"),
    ("in the net", "NET"),
    ("can i have it in net", "NET"),
    ("can i have that in net", "NET"),
    ("show me net", "NET"),
    ("new english translation", "NET"),
    ("in new english", "NET"),
    // CEV (Contemporary English Version)
    ("give me cev", "CEV"),
    ("read in cev", "CEV"),
    ("switch to cev", "CEV"),
    ("in the cev", "CEV"),
    ("can i have it in cev", "CEV"),
    ("can i have that in cev", "CEV"),
    ("show me cev", "CEV"),
    ("contemporary english", "CEV"),
    ("contemporary english version", "CEV"),
    ("in contemporary english", "CEV"),
    // GNT/GNB (Good News Translation / Good News Bible)
    ("give me gnt", "GNT"),
    ("give me gnb", "GNT"),
    ("read in gnt", "GNT"),
    ("read in gnb", "GNT"),
    ("switch to gnt", "GNT"),
    ("switch to gnb", "GNT"),
    ("in the gnt", "GNT"),
    ("in the gnb", "GNT"),
    ("can i have it in gnt", "GNT"),
    ("can i have that in gnt", "GNT"),
    ("show me gnt", "GNT"),
    ("show me gnb", "GNT"),
    ("good news", "GNT"),
    ("good news translation", "GNT"),
    ("good news bible", "GNT"),
    ("in good news", "GNT"),
];

/// Maximum chapter count per book (`book_number` 1-66).
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
fn is_valid_reference(book_number: i32, chapter: i32) -> bool {
    if !(1..=66).contains(&book_number) {
        return false;
    }
    #[expect(clippy::cast_sign_loss, reason = "book_number validated to be 1..=66")]
    let max_ch = MAX_CHAPTERS[book_number as usize];
    chapter >= 1 && chapter <= max_ch
}

/// Confidence assigned to chapter-only references (no verse specified).
/// Set above the auto-queue threshold (0.80) so partial refs reach the queue immediately.
const CHAPTER_ONLY_CONFIDENCE: f64 = 0.85;

/// Filler phrases commonly found in sermon transcripts that confuse detection.
/// These are stripped (case-insensitively) before the text reaches the automaton.
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

/// Strip common sermon filler phrases from transcript text so they do not
/// confuse the Aho-Corasick automaton or the parser.
///
/// Performs simple case-insensitive removal of each phrase in [`FILLER_PHRASES`],
/// plus a special pattern for "look at" when followed by what looks like a book name
/// (starts with an uppercase letter).
fn clean_transcript(text: &str) -> String {
    let mut result = text.to_string();

    // Remove fixed filler phrases (case-insensitive)
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

    // Handle "look at" only when followed by a word starting with an uppercase letter
    // (heuristic for a book name).
    loop {
        let lower = result.to_lowercase();
        if let Some(pos) = lower.find("look at") {
            let after_pos = pos + "look at".len();
            let after = &result[after_pos..];
            let trimmed = after.trim_start();
            if let Some(ch) = trimmed.chars().next() {
                if ch.is_ascii_uppercase() {
                    // Remove "look at" (keep the rest including the book name)
                    result = format!("{}{}", &result[..pos], &result[after_pos..]);
                    continue;
                }
            }
            break; // "look at" not followed by uppercase — leave it
        }
        break;
    }

    // Collapse multiple spaces and trim
    let mut prev_space = false;
    let collapsed: String = result
        .chars()
        .filter(|&c| {
            if c == ' ' {
                if prev_space {
                    return false;
                }
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
const INCOMPLETE_REF_TIMEOUT_MS: u128 = 5000;

/// An incomplete reference waiting for verse completion.
#[derive(Debug, Clone)]
struct IncompleteRef {
    verse_ref: VerseRef,
    timestamp: Instant,
}

/// Main orchestrator for direct Bible reference detection.
///
/// Uses Aho-Corasick automaton for fast book name matching, then parses
/// chapter:verse patterns (both numeric and spoken forms) and maintains
/// context for resolving partial references.
///
/// Supports incomplete reference handling: when a chapter-only reference
/// is detected (e.g., "Genesis 3"), it's held for up to 5 seconds waiting
/// for a verse completion (e.g., "verse 16"). If no completion arrives,
/// the chapter-only reference is emitted defaulting to verse 1.
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

pub struct DirectDetector {
    matcher: BookMatcher,
    context: ReferenceContext,
    /// Pending incomplete reference waiting for verse completion.
    incomplete: Option<IncompleteRef>,
    /// Recently detected verses for "previous verse" navigation (most recent first).
    recent_detections: VecDeque<VerseRef>,
}

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
    /// Returns the translation abbreviation if found (e.g., "NIV", "ESV").
    ///
    /// Matches both full phrases ("new international version") and bare
    /// abbreviations ("NIV", "AMP") as standalone words.
    pub fn detect_translation_command(&self, text: &str) -> Option<String> {
        let lower = text.to_lowercase();

        // First check full phrases (higher confidence)
        for (pattern, abbrev) in TRANSLATION_COMMANDS {
            if lower.contains(pattern) {
                log::info!("[DET-DIRECT] Translation command detected: {abbrev}");
                return Some(abbrev.to_string());
            }
        }

        // Then check bare abbreviations as standalone words
        // Split into words and check each against known abbreviations
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
                "amp" | "amplified" => Some("AMP"),
                "sparv" | "spanish" => Some("SpaRV"),
                "frejnd" | "french" => Some("FreJND"),
                "porblivre" | "portuguese" => Some("PorBLivre"),
                "msg" | "message" => Some("MSG"),
                "csb" => Some("CSB"),
                "hcsb" => Some("HCSB"),
                "rsv" => Some("RSV"),
                "nrsv" => Some("NRSV"),
                "net" => Some("NET"),
                "cev" => Some("CEV"),
                "gnt" | "gnb" => Some("GNT"),
                _ => None,
            };
            if let Some(abbrev) = matched {
                log::info!("[DET-DIRECT] Translation abbreviation detected: {abbrev}");
                return Some(abbrev.to_string());
            }
        }

        None
    }

    /// Detect Bible references in the given transcript text.
    ///
    /// Returns a list of Detection objects for each reference found.
    pub fn detect(&mut self, text: &str) -> Vec<Detection> {
        // Step 0: Clean filler phrases from the transcript
        let cleaned = clean_transcript(text);
        let text = &cleaned;

        let mut detections = Vec::new();

        // Step 0b: Check for "previous verse" / "last verse" navigation commands
        if let Some(prev_detection) = self.check_previous_verse_command(text) {
            detections.push(prev_detection);
            return detections;
        }

        // Step 0c: Check if there's a pending incomplete reference.
        // Try to complete it with a verse continuation, or expire it on timeout.
        // The chapter-only detection was already emitted when first seen — no
        // re-emission needed on timeout.
        if let Some(ref incomplete) = self.incomplete.clone() {
            let elapsed = incomplete.timestamp.elapsed().as_millis();
            if elapsed > INCOMPLETE_REF_TIMEOUT_MS {
                // Timeout: chapter-only ref was already emitted immediately.
                // Just clean up the pending state (EDGE-02).
                self.incomplete = None;
            } else if let Some(verse) = try_extract_verse_continuation(text) {
                // Verse spoken — refine the chapter-only detection (DET-02).
                let mut completed = incomplete.verse_ref.clone();
                completed.verse_start = verse;
                detections.push(self.make_direct_detection(
                    &completed,
                    compute_confidence(&completed, &completed),
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

        // Step 1: Find all book name matches using Aho-Corasick
        let book_matches = self.matcher.find_books(text);

        // Step 1b: If the automaton found nothing, try fuzzy matching as fallback
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

        // Step 2 & 3: Parse references and resolve context
        for book_match in effective_matches {
            if let Some(verse_ref) = parser::parse_reference(text, book_match) {
                // Resolve any partial references using context
                let resolved = self.context.resolve(&verse_ref);

                // Skip if we couldn't resolve to a meaningful reference
                if resolved.book_number == 0 || resolved.chapter == 0 {
                    self.context.update(&verse_ref);
                    continue;
                }

                // Skip impossible references (e.g., "Mark 30:1" — Mark has 16 chapters)
                if resolved.chapter > 0 && !is_valid_reference(resolved.book_number, resolved.chapter) {
                    continue;
                }

                // Chapter-only: emit immediately with verse 1, hold for refinement (DET-01)
                if resolved.verse_start == 0 {
                    // Skip re-emission if this exact book+chapter is already pending
                    let already_pending = self.incomplete.as_ref().is_some_and(|inc| {
                        inc.verse_ref.book_number == resolved.book_number
                            && inc.verse_ref.chapter == resolved.chapter
                    });

                    if !already_pending {
                        // Emit chapter-only detection immediately (defaults to verse 1)
                        let mut ref_with_verse = resolved.clone();
                        ref_with_verse.verse_start = 1;

                        let snippet = extract_snippet(text, book_match.start, book_match.end);
                        #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;

                        detections.push(Detection {
                            verse_ref: ref_with_verse.clone(),
                            verse_id: None,
                            confidence: CHAPTER_ONLY_CONFIDENCE,
                            source: DetectionSource::DirectReference,
                            transcript_snippet: snippet,
                            detected_at: now,
                            is_chapter_only: true,
                        });
                        self.push_recent(&ref_with_verse);
                    }

                    // Store/refresh as incomplete for verse refinement
                    self.incomplete = Some(IncompleteRef {
                        verse_ref: resolved.clone(),
                        timestamp: Instant::now(),
                    });
                    self.context.update(&resolved);
                    continue;
                }

                // Full reference — also clear any pending incomplete
                self.incomplete = None;

                let confidence = compute_confidence(&resolved, &verse_ref);
                let snippet = extract_snippet(text, book_match.start, book_match.end);

                #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
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
                    is_chapter_only: false,
                };

                // Track in recent detections for "previous verse" support
                self.push_recent(&resolved);

                detections.push(detection);
                self.context.update(&resolved);
            }
        }

        detections
    }

    /// Check if text contains a "previous verse" / "last verse" command.
    fn check_previous_verse_command(&self, text: &str) -> Option<Detection> {
        let lower = text.to_lowercase();
        for phrase in PREVIOUS_VERSE_PHRASES {
            if lower.contains(phrase) {
                if let Some(prev_ref) = self.recent_detections.front() {
                    #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    return Some(Detection {
                        verse_ref: prev_ref.clone(),
                        verse_id: None,
                        confidence: 0.92,
                        source: DetectionSource::DirectReference,
                        transcript_snippet: text.to_string(),
                        detected_at: now,
                        is_chapter_only: false,
                    });
                }
            }
        }
        None
    }

    /// Push a verse ref to the recent detections queue (max 5).
    fn push_recent(&mut self, verse_ref: &VerseRef) {
        // Don't push duplicates of the most recent
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

    /// Build a Detection from a resolved `VerseRef`.
    #[expect(clippy::unused_self, reason = "method kept on self for future extensibility")]
    fn make_direct_detection(
        &self,
        verse_ref: &VerseRef,
        confidence: f64,
        text: &str,
        start: usize,
        end: usize,
    ) -> Detection {
        let snippet = extract_snippet(text, start, end.min(text.len()));
        #[expect(clippy::cast_possible_truncation, reason = "timestamp millis won't exceed u64 for centuries")]
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
            is_chapter_only: false,
        }
    }
}

impl Default for DirectDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Try to extract a verse number from text that may be a continuation
/// of an incomplete reference. Matches patterns like:
/// - "verse 16", "verses 3"
/// - "16" (bare number at start)
/// - "and verse 5"
fn try_extract_verse_continuation(text: &str) -> Option<i32> {
    let lower = text.to_lowercase();
    let trimmed = lower.trim();

    // Pattern: "verse N" or "verses N"
    for prefix in &["verse ", "verses ", "and verse ", "and verses "] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let num_str: String = rest.chars().take_while(char::is_ascii_digit).collect();
            if let Ok(n) = num_str.parse::<i32>() {
                if n > 0 {
                    return Some(n);
                }
            }
            // Try spoken number
            let word: String = rest.chars().take_while(|c| c.is_alphabetic()).collect();
            if let Some(n) = parser::parse_spoken_number(&word) {
                if n > 0 {
                    return Some(n);
                }
            }
        }
    }

    // Pattern: bare number at start (e.g., "16 for God so loved")
    let num_str: String = trimmed.chars().take_while(char::is_ascii_digit).collect();
    if !num_str.is_empty() && num_str.len() <= 3 {
        if let Ok(n) = num_str.parse::<i32>() {
            if n > 0 && n <= 176 {
                // Max verse number in Bible (Psalm 119)
                return Some(n);
            }
        }
    }

    None
}

/// Compute a confidence score for the detection.
/// Full explicit references (book + chapter + verse) get 1.0.
/// References missing some parts get lower scores.
fn compute_confidence(_resolved: &VerseRef, original: &VerseRef) -> f64 {
    let mut confidence: f64 = 0.90;

    // Bonus for having explicit chapter
    if original.chapter > 0 {
        confidence += 0.04;
    }

    // Bonus for having explicit verse
    if original.verse_start > 0 {
        confidence += 0.04;
    }

    // Bonus for having explicit book
    if original.book_number > 0 {
        confidence += 0.02;
    }

    confidence.min(1.0_f64)
}

/// Extract a snippet of text around the reference for context.
fn extract_snippet(text: &str, start: usize, end: usize) -> String {
    let snippet_start = start.saturating_sub(30);
    let snippet_end = if end + 30 < text.len() {
        end + 30
    } else {
        text.len()
    };

    // Adjust to word boundaries
    let snippet_start = text[snippet_start..start]
        .rfind(' ')
        .map_or(snippet_start, |p| snippet_start + p + 1);

    let snippet_end = text[end..snippet_end]
        .find(' ')
        .map_or(snippet_end, |p| {
            // Find the end of the relevant portion (after a few more words)
            let after_space = end + p + 1;
            text[after_space..snippet_end]
                .find(' ')
                .map_or(snippet_end, |p2| after_space + p2)
        });

    text[snippet_start..snippet_end].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_reference() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Jesus said in John 3:16 that God loved the world");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "John");
        assert_eq!(results[0].verse_ref.chapter, 3);
        assert_eq!(results[0].verse_ref.verse_start, 16);
    }

    #[test]
    fn test_spoken_reference() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("David in Psalm thirty two verse one now says");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Psalms");
        assert_eq!(results[0].verse_ref.chapter, 32);
        assert_eq!(results[0].verse_ref.verse_start, 1);
    }

    #[test]
    fn test_verse_range() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Let's read Romans 8:28-30 together");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Romans");
        assert_eq!(results[0].verse_ref.chapter, 8);
        assert_eq!(results[0].verse_ref.verse_start, 28);
        assert_eq!(results[0].verse_ref.verse_end, Some(30));
    }

    #[test]
    fn test_numbered_book() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Paul wrote in 1 Corinthians 13:4 about love");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "1 Corinthians");
        assert_eq!(results[0].verse_ref.chapter, 13);
        assert_eq!(results[0].verse_ref.verse_start, 4);
    }

    #[test]
    fn test_chapter_only_emitted_immediately() {
        // Chapter-only references are emitted immediately with verse=1 and is_chapter_only=true
        let mut detector = DirectDetector::new();
        let results = detector.detect("Genesis 3 is about the fall of man");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].verse_ref.book_name, "Genesis");
        assert_eq!(results[0].verse_ref.chapter, 3);
        assert_eq!(results[0].verse_ref.verse_start, 1);
        assert!(results[0].is_chapter_only);
        assert!((results[0].confidence - 0.85).abs() < f64::EPSILON);
        // Also held as incomplete for verse refinement
        assert!(detector.incomplete.is_some());
    }

    #[test]
    fn test_chapter_only_no_duplicate_on_repeat() {
        // Same book+chapter in a subsequent call should not re-emit
        let mut detector = DirectDetector::new();
        let results = detector.detect("Genesis 3");
        assert_eq!(results.len(), 1);
        assert!(results[0].is_chapter_only);

        // Same text again — already pending, skip re-emission
        let results = detector.detect("Genesis 3");
        assert!(results.is_empty());
        assert!(detector.incomplete.is_some());
    }

    #[test]
    fn test_incomplete_ref_completed_by_verse() {
        // Chapter-only emitted first, then refined by verse continuation
        let mut detector = DirectDetector::new();
        // First: chapter-only — emitted immediately
        let results = detector.detect("Genesis 3");
        assert_eq!(results.len(), 1);
        assert!(results[0].is_chapter_only);
        assert!(detector.incomplete.is_some());

        // Second: verse continuation — refines the detection
        let results = detector.detect("verse 15");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].verse_ref.book_name, "Genesis");
        assert_eq!(results[0].verse_ref.chapter, 3);
        assert_eq!(results[0].verse_ref.verse_start, 15);
        assert!(!results[0].is_chapter_only);
        assert!(detector.incomplete.is_none());
    }

    #[test]
    fn test_new_book_supersedes_incomplete() {
        // EDGE-01: a new book/chapter replaces the pending incomplete cleanly
        let mut detector = DirectDetector::new();
        let results = detector.detect("Genesis 3");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].verse_ref.book_name, "Genesis");

        // Different book — supersedes Genesis 3
        let results = detector.detect("let's look at John 1");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].verse_ref.book_name, "John");
        assert_eq!(results[0].verse_ref.chapter, 1);
        assert!(results[0].is_chapter_only);
        // Incomplete now tracks John 1, not Genesis 3
        let inc = detector.incomplete.as_ref().unwrap();
        assert_eq!(inc.verse_ref.book_name, "John");
    }

    #[test]
    fn test_abandoned_partial_no_stale_state() {
        // EDGE-02: after timeout, incomplete is cleaned up without re-emission
        let mut detector = DirectDetector::new();
        let results = detector.detect("Genesis 3");
        assert_eq!(results.len(), 1);
        assert!(detector.incomplete.is_some());

        // Simulate timeout by replacing with an expired timestamp
        detector.incomplete = Some(IncompleteRef {
            verse_ref: detector.incomplete.as_ref().unwrap().verse_ref.clone(),
            timestamp: Instant::now() - std::time::Duration::from_secs(10),
        });

        // Next detect call should clean up without emitting
        let results = detector.detect("something unrelated");
        assert!(results.is_empty());
        assert!(detector.incomplete.is_none());
    }

    #[test]
    fn test_previous_verse_command() {
        let mut detector = DirectDetector::new();
        // First detect a verse
        let results = detector.detect("John 3:16");
        assert!(!results.is_empty());

        // Then ask for "previous verse"
        let results = detector.detect("can you show me the last verse");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "John");
        assert_eq!(results[0].verse_ref.chapter, 3);
        assert_eq!(results[0].verse_ref.verse_start, 16);
    }

    #[test]
    fn test_previous_verse_no_history() {
        let mut detector = DirectDetector::new();
        // No previous detection — should return empty
        let results = detector.detect("go back to that verse");
        assert!(results.is_empty());
    }

    #[test]
    fn test_no_reference() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("The weather is nice today");
        assert!(results.is_empty());
    }

    #[test]
    fn test_spoken_chapter_verse_keywords() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Isaiah chapter fifty three verse five");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Isaiah");
        assert_eq!(results[0].verse_ref.chapter, 53);
        assert_eq!(results[0].verse_ref.verse_start, 5);
    }

    #[test]
    fn test_multiple_references() {
        let mut detector = DirectDetector::new();
        let results =
            detector.detect("Compare John 3:16 with Romans 5:8 for understanding God's love");
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].verse_ref.book_name, "John");
        assert_eq!(results[1].verse_ref.book_name, "Romans");
    }

    #[test]
    fn test_confidence_range() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("John 3:16");
        assert!(!results.is_empty());
        assert!(results[0].confidence >= 0.90);
        assert!(results[0].confidence <= 1.0);
    }

    #[test]
    fn test_detection_source() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("John 3:16");
        assert!(!results.is_empty());
        assert!(matches!(
            results[0].source,
            DetectionSource::DirectReference
        ));
    }

    #[test]
    fn test_clean_transcript() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Please open your bibles to Ephesians chapter 6 verse 10");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Ephesians");
    }

    #[test]
    fn test_clean_transcript_lets_turn_to() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Let's turn to Romans 8:28 and read together");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Romans");
        assert_eq!(results[0].verse_ref.chapter, 8);
        assert_eq!(results[0].verse_ref.verse_start, 28);
    }

    #[test]
    fn test_clean_transcript_the_bible_says_in() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("The bible says in John 3:16 that God loved the world");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "John");
    }

    #[test]
    fn test_clean_transcript_look_at() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Now look at Genesis 1:1 for the beginning");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Genesis");
    }

    #[test]
    fn test_fuzzy_fallback_filipians() {
        let mut detector = DirectDetector::new();
        let results = detector.detect("Filipians chapter 4 verse 13");
        assert!(!results.is_empty());
        assert_eq!(results[0].verse_ref.book_name, "Philippians");
        assert_eq!(results[0].verse_ref.chapter, 4);
        assert_eq!(results[0].verse_ref.verse_start, 13);
    }

    // ========== Translation Command Detection Tests ==========

    #[test]
    fn test_translation_command_basic_niv() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me niv"), Some("NIV".to_string()));
        assert_eq!(detector.detect_translation_command("read in niv"), Some("NIV".to_string()));
        assert_eq!(detector.detect_translation_command("switch to niv"), Some("NIV".to_string()));
    }

    #[test]
    fn test_translation_command_natural_language() {
        let detector = DirectDetector::new();
        assert_eq!(
            detector.detect_translation_command("can i have it in amplified"),
            Some("AMP".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("can i have that in amplified version"),
            Some("AMP".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("can i have it in esv"),
            Some("ESV".to_string())
        );
    }

    #[test]
    fn test_translation_command_full_names() {
        let detector = DirectDetector::new();
        assert_eq!(
            detector.detect_translation_command("new international version"),
            Some("NIV".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("king james version"),
            Some("KJV".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("english standard version"),
            Some("ESV".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("amplified bible"),
            Some("AMP".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("new living translation"),
            Some("NLT".to_string())
        );
    }

    #[test]
    fn test_translation_command_bare_abbreviations() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("niv"), Some("NIV".to_string()));
        assert_eq!(detector.detect_translation_command("esv"), Some("ESV".to_string()));
        assert_eq!(detector.detect_translation_command("kjv"), Some("KJV".to_string()));
        assert_eq!(detector.detect_translation_command("amp"), Some("AMP".to_string()));
        assert_eq!(detector.detect_translation_command("nasb"), Some("NASB".to_string()));
        assert_eq!(detector.detect_translation_command("nkjv"), Some("NKJV".to_string()));
        assert_eq!(detector.detect_translation_command("nlt"), Some("NLT".to_string()));
    }

    #[test]
    fn test_translation_command_in_sentence() {
        let detector = DirectDetector::new();
        assert_eq!(
            detector.detect_translation_command("show me genesis 3:16 in the amplified"),
            Some("AMP".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("read john 3:16 in niv"),
            Some("NIV".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("i want to read that in the message"),
            Some("MSG".to_string())
        );
    }

    #[test]
    fn test_translation_command_message_bible() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me the message"), Some("MSG".to_string()));
        assert_eq!(detector.detect_translation_command("read in the message"), Some("MSG".to_string()));
        assert_eq!(detector.detect_translation_command("switch to message"), Some("MSG".to_string()));
        assert_eq!(detector.detect_translation_command("message version"), Some("MSG".to_string()));
        assert_eq!(detector.detect_translation_command("message bible"), Some("MSG".to_string()));
    }

    #[test]
    fn test_translation_command_csb_hcsb() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me csb"), Some("CSB".to_string()));
        assert_eq!(detector.detect_translation_command("christian standard bible"), Some("CSB".to_string()));
        assert_eq!(detector.detect_translation_command("give me hcsb"), Some("HCSB".to_string()));
        assert_eq!(detector.detect_translation_command("holman christian standard"), Some("HCSB".to_string()));
    }

    #[test]
    fn test_translation_command_revised_standard() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me rsv"), Some("RSV".to_string()));
        assert_eq!(detector.detect_translation_command("revised standard version"), Some("RSV".to_string()));
        assert_eq!(detector.detect_translation_command("give me nrsv"), Some("NRSV".to_string()));
        assert_eq!(detector.detect_translation_command("new revised standard"), Some("NRSV".to_string()));
    }

    #[test]
    fn test_translation_command_good_news() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me gnt"), Some("GNT".to_string()));
        assert_eq!(detector.detect_translation_command("give me gnb"), Some("GNT".to_string()));
        assert_eq!(detector.detect_translation_command("good news translation"), Some("GNT".to_string()));
        assert_eq!(detector.detect_translation_command("good news bible"), Some("GNT".to_string()));
    }

    #[test]
    fn test_translation_command_net_cev() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("give me net"), Some("NET".to_string()));
        assert_eq!(detector.detect_translation_command("new english translation"), Some("NET".to_string()));
        assert_eq!(detector.detect_translation_command("give me cev"), Some("CEV".to_string()));
        assert_eq!(detector.detect_translation_command("contemporary english version"), Some("CEV".to_string()));
    }

    #[test]
    fn test_translation_command_non_english() {
        let detector = DirectDetector::new();
        // Spanish
        assert_eq!(detector.detect_translation_command("give me spanish"), Some("SpaRV".to_string()));
        assert_eq!(detector.detect_translation_command("read in reina valera"), Some("SpaRV".to_string()));
        assert_eq!(detector.detect_translation_command("in spanish"), Some("SpaRV".to_string()));

        // French
        assert_eq!(detector.detect_translation_command("give me french"), Some("FreJND".to_string()));
        assert_eq!(detector.detect_translation_command("read in french"), Some("FreJND".to_string()));
        assert_eq!(detector.detect_translation_command("darby french"), Some("FreJND".to_string()));

        // Portuguese
        assert_eq!(detector.detect_translation_command("give me portuguese"), Some("PorBLivre".to_string()));
        assert_eq!(detector.detect_translation_command("biblia livre"), Some("PorBLivre".to_string()));
        assert_eq!(detector.detect_translation_command("in portuguese"), Some("PorBLivre".to_string()));
    }

    #[test]
    fn test_translation_command_case_insensitive() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("GIVE ME NIV"), Some("NIV".to_string()));
        assert_eq!(detector.detect_translation_command("Give Me Amplified"), Some("AMP".to_string()));
        assert_eq!(detector.detect_translation_command("CAN I HAVE IT IN ESV"), Some("ESV".to_string()));
    }

    #[test]
    fn test_translation_command_show_me_variations() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("show me niv"), Some("NIV".to_string()));
        assert_eq!(detector.detect_translation_command("show me amplified"), Some("AMP".to_string()));
        assert_eq!(detector.detect_translation_command("show me the message"), Some("MSG".to_string()));
    }

    #[test]
    fn test_translation_command_no_match() {
        let detector = DirectDetector::new();
        assert_eq!(detector.detect_translation_command("genesis 3 verse 16"), None);
        assert_eq!(detector.detect_translation_command("the weather is nice"), None);
        assert_eq!(detector.detect_translation_command("tell me about the bible"), None);
    }

    #[test]
    fn test_translation_command_partial_match() {
        let detector = DirectDetector::new();
        // Should match even with extra words
        assert_eq!(
            detector.detect_translation_command("i would like to read that in amplified version please"),
            Some("AMP".to_string())
        );
        assert_eq!(
            detector.detect_translation_command("could you show me that verse in the niv translation"),
            Some("NIV".to_string())
        );
    }
}
