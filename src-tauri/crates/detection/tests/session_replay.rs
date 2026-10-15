use rhema_detection::clock::DetectionClock;
use rhema_detection::{DirectDetector, ReadingMode};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

struct ReplayClock {
    origin: Instant,
    elapsed_ms: AtomicU64,
}
impl ReplayClock {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            origin: Instant::now(),
            elapsed_ms: AtomicU64::new(0),
        })
    }
    fn at(&self, elapsed_ms: u64) {
        self.elapsed_ms.store(elapsed_ms, Ordering::Relaxed);
    }
}
impl DetectionClock for ReplayClock {
    fn now(&self) -> Instant {
        self.origin + Duration::from_millis(self.elapsed_ms.load(Ordering::Relaxed))
    }
}
#[test]
fn contextual_reference_expires_on_the_replay_clock() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    assert!(!detector.detect("John 3:16").is_empty());
    clock.at(89_999);
    let next = detector.detect("verse 17");
    assert_eq!(next[0].verse_ref.verse_start, 17);
    clock.at(180_000);
    assert!(detector.detect("verse 18").is_empty());
}
#[test]
fn reading_timeout_uses_the_same_replay_clock() {
    let clock = ReplayClock::new();
    let mut reading = ReadingMode::with_clock(clock.clone());
    reading.start(
        43,
        "John",
        3,
        16,
        vec![(16, "For God so loved the world".into())],
    );
    clock.at(180_001);
    assert!(reading
        .check_transcript("A narration unrelated to the loaded text")
        .is_none());
    assert!(!reading.is_active());
    assert!(reading.has_verses());
}

/// The direct→reading transition used by the existing native coordinator:
/// accepted references restart on a new book/chapter; reading owns subsequent verse commands.
fn apply_direct(reading: &mut ReadingMode, detections: &[rhema_detection::Detection]) {
    for detection in detections {
        let reference = &detection.verse_ref;
        if !reading.is_active()
            || reading.current_book() != reference.book_number
            || reading.current_chapter() != reference.chapter
        {
            reading.start(
                reference.book_number,
                &reference.book_name,
                reference.chapter,
                reference.verse_start,
                (1..=rhema_detection::direct::versification::max_verse(
                    reference.book_number,
                    reference.chapter,
                )
                .expect("valid fixture chapter"))
                    .map(|verse| (verse, format!("Synthetic fixture text unique {verse}")))
                    .collect(),
            );
        }
    }
}
#[test]
fn person_name_does_not_replace_the_active_reading_context() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    let mut reading = ReadingMode::with_clock(clock.clone());
    apply_direct(&mut reading, &detector.detect("1 Kings 18:1"));
    // Minimized ordering from #175: name-only partial, narration, then a later verse command.
    for (at, text, is_final) in [
        (1_000, "Obadiah", false),
        (2_000, "Obadiah was the governor", true),
        (53_000, "Look at verse 6, and Ahab said to Obadiah,", false),
        (
            54_000,
            "Look at verse 6, and Ahab said to Obadiah, go",
            true,
        ),
    ] {
        clock.at(at);
        let found = detector.detect(text);
        assert!(
            found.iter().all(|hit| hit.verse_ref.book_number == 11),
            "unrelated direct reference at {at}: {found:?}"
        );
        if is_final {
            apply_direct(&mut reading, &found);
        }
        assert_eq!(
            (reading.current_book(), reading.current_chapter()),
            (11, 18)
        );
    }
}
#[test]
fn fuzzy_narration_does_not_seed_a_different_book_for_later_verse_commands() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    let mut reading = ReadingMode::with_clock(clock.clone());
    apply_direct(&mut reading, &detector.detect("1 Kings 18:1"));
    clock.at(1_000);
    assert!(detector.detect("We have seen this many times").is_empty());
    clock.at(53_000);
    let found = detector.detect("Verse 3");
    assert!(
        found.iter().all(|hit| hit.verse_ref.book_number == 11),
        "narration changed book: {found:?}"
    );
    apply_direct(&mut reading, &found);
    assert_eq!(
        (reading.current_book(), reading.current_chapter()),
        (11, 18)
    );
}

#[test]
fn a_bare_mention_of_the_same_book_cannot_reset_its_confirmed_chapter() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    detector.detect("John 3:16");
    clock.at(1_000);
    detector.detect("John");
    clock.at(2_000);
    let found = detector.detect("verse 17");
    assert_eq!(
        (
            found[0].verse_ref.book_number,
            found[0].verse_ref.chapter,
            found[0].verse_ref.verse_start
        ),
        (43, 3, 17)
    );
}
#[test]
fn reading_accumulation_stays_bounded_when_matching_narration_keeps_the_session_active() {
    let clock = ReplayClock::new();
    let mut reading = ReadingMode::with_clock(clock.clone());
    reading.start(
        43,
        "John",
        3,
        16,
        vec![(16, "For God so loved the world".into())],
    );
    for second in 1..=7_200 {
        clock.at(second * 1_000);
        reading
            .check_transcript("For God so loved the world. Àwọn ọ̀rọ̀ ìtàn and ongoing narration.");
        assert!(
            reading.buffered_text_bytes() <= 8_192,
            "buffer exceeded bound after {second}s: {} bytes",
            reading.buffered_text_bytes()
        );
    }
}

#[test]
fn narration_cannot_attach_a_later_verse_command_to_a_person_name() {
    for text in [
        "Obadiah was the governor, and we continue with verse 6",
        "James spoke about prayer, now read verse 3",
        "Titus travelled with Paul, now read verse 4",
        "We remember those times as we read verse 3",
    ] {
        let mut detector = DirectDetector::new();
        detector.detect("1 Kings 18:1");
        let found = detector.detect(text);
        assert!(
            found.iter().all(|hit| hit.verse_ref.book_number == 11),
            "narrative name became a citation: {text:?}: {found:?}"
        );
    }
}
#[test]
fn explicit_citations_and_spoken_partial_completion_keep_working() {
    for (text, book, chapter, verse) in [
        ("Obadiah chapter one verse six", 31, 1, 6),
        ("Titus 2:3", 56, 2, 3),
        ("James chapter five verse seventeen", 59, 5, 17),
        ("Isaiah 65:24", 23, 65, 24),
        ("Filipians chapter four verse thirteen", 50, 4, 13),
        ("John's gospel chapter three verse sixteen", 43, 3, 16),
    ] {
        let mut detector = DirectDetector::new();
        detector.detect("1 Kings 18:1");
        let found = detector.detect(text);
        assert!(
            found.iter().any(|hit| (
                hit.verse_ref.book_number,
                hit.verse_ref.chapter,
                hit.verse_ref.verse_start
            ) == (book, chapter, verse)),
            "explicit citation lost: {text:?}: {found:?}"
        );
    }
    let mut detector = DirectDetector::new();
    assert!(detector.detect("John").is_empty());
    assert!(detector.detect("three").is_empty());
    let found = detector.detect("verse sixteen");
    assert_eq!(
        (
            found[0].verse_ref.book_number,
            found[0].verse_ref.chapter,
            found[0].verse_ref.verse_start
        ),
        (43, 3, 16)
    );
}

#[test]
fn expired_direct_context_does_not_make_a_person_name_authoritative_again() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    detector.detect("1 Kings 18:1");
    clock.at(100_000);
    detector.detect("Obadiah");
    clock.at(101_000);
    let found = detector.detect("verse 6");
    assert!(
        found.is_empty(),
        "expired context accepted an ambiguous new book: {found:?}"
    );
}
#[test]
fn paused_reading_resumes_on_an_explicit_verse_command() {
    let clock = ReplayClock::new();
    let mut reading = ReadingMode::with_clock(clock.clone());
    reading.start(
        43,
        "John",
        3,
        16,
        vec![
            (16, "For God so loved the world".into()),
            (17, "God sent not his son to condemn".into()),
        ],
    );
    clock.at(180_001);
    reading.check_transcript("An unrelated narration");
    assert!(!reading.is_active());
    clock.at(181_000);
    let advance = reading.check_transcript("verse 17");
    assert_eq!(
        advance.map(|value| (value.book_number, value.chapter, value.verse)),
        Some((43, 3, 17))
    );
    assert!(reading.is_active());
}

#[test]
fn ordinary_number_pairs_and_times_are_not_reference_corrections() {
    for text in [
        "There are 3 5 ways to explain this",
        "The meeting starts at 8:20 am",
        "There were 12 disciples",
        "This is an ordinary sentence",
    ] {
        let mut detector = DirectDetector::new();
        detector.detect("1 Kings 18:1");
        assert!(
            detector.detect(text).is_empty(),
            "ordinary narration became a reference: {text:?}"
        );
    }
}
#[test]
fn combined_direct_and_reading_replay_preserves_context_at_each_service_duration() {
    for minutes in [10_u64, 30, 60, 120] {
        let clock = ReplayClock::new();
        let mut detector = DirectDetector::with_clock(clock.clone());
        let mut reading = ReadingMode::with_clock(clock.clone());
        for minute in 0..minutes {
            for (offset, text) in [
                (0, "1 Kings 18:1"),
                (1_000, "Obadiah"),
                (2_000, "verse 6"),
                (3_000, "We have seen this many times"),
                (20_000, "verse seven"),
                (40_000, "The meeting starts at 8:20 am"),
            ] {
                clock.at(minute * 60_000 + offset);
                let found = detector.detect(text);
                assert!(
                    found
                        .iter()
                        .all(|hit| hit.verse_ref.book_number == 11 && hit.verse_ref.chapter == 18),
                    "unexpected reference in {minutes}min replay: {text:?}: {found:?}"
                );
                apply_direct(&mut reading, &found);
                reading.check_transcript(text);
                assert_eq!(
                    (reading.current_book(), reading.current_chapter()),
                    (11, 18)
                );
                assert!(detector.recent_detections().len() <= 5);
                assert!(reading.buffered_text_bytes() <= 8_192);
            }
        }
        assert_eq!(reading.current_verse(), Some(7));
    }
}
#[test]
fn a_large_multibyte_fragment_is_bounded_before_retention() {
    let mut reading = ReadingMode::new();
    reading.start(
        43,
        "John",
        3,
        16,
        vec![(16, "For God so loved the world".into())],
    );
    reading.check_transcript(&format!(
        "{} For God so loved the world",
        "Àwọn ọ̀rọ̀ ".repeat(10_000)
    ));
    assert!(reading.buffered_text_bytes() <= 8_192);
}

#[test]
fn repeated_partial_with_an_unfinished_chapter_cannot_reset_a_confirmed_chapter() {
    let clock = ReplayClock::new();
    let mut detector = DirectDetector::with_clock(clock.clone());
    detector.detect("James chapter 5 reading from verse 17");
    clock.at(1_000);
    detector.detect("James chapter 5 reading from verse 17. James chapter");
    clock.at(2_000);
    let found = detector.detect("verse 17");
    assert_eq!(
        (
            found[0].verse_ref.book_number,
            found[0].verse_ref.chapter,
            found[0].verse_ref.verse_start
        ),
        (59, 5, 17)
    );
}

#[test]
fn an_invalid_chapter_cannot_borrow_a_previously_confirmed_chapter() {
    for previous in ["John 3:16", "Mark 3:16"] {
        let mut detector = DirectDetector::new();
        assert!(!detector.detect(previous).is_empty());
        assert!(detector.detect("Mark 30:1").is_empty());
        assert!(
            detector.detect("verse 5").is_empty(),
            "rejected chapter borrowed context after {previous}"
        );
        let repaired = detector.detect("3:5");
        assert_eq!(repaired.len(), 1);
        let reference = &repaired[0].verse_ref;
        assert_eq!(
            (
                reference.book_number,
                reference.chapter,
                reference.verse_start
            ),
            (41, 3, 5)
        );
    }
}

#[test]
fn explicit_navigation_never_falls_back_to_the_previous_book() {
    let mut detector = DirectDetector::new();
    detector.detect("John 3:16");
    let found = detector.detect("Turn to Mark in chapter 2 verse 5");
    assert_eq!(found.len(), 1);
    assert_eq!(
        (
            found[0].verse_ref.book_number,
            found[0].verse_ref.chapter,
            found[0].verse_ref.verse_start
        ),
        (41, 2, 5)
    );
    let next = detector.detect("verse 6");
    assert_eq!(
        (next[0].verse_ref.book_number, next[0].verse_ref.chapter),
        (41, 2)
    );
    let unsupported = detector.detect("Turn to Luke over at chapter 4 verse 2");
    assert!(
        unsupported.is_empty(),
        "unsupported book navigation acquired old book: {unsupported:?}"
    );
    let next = detector.detect("verse 7");
    assert_eq!(
        (next[0].verse_ref.book_number, next[0].verse_ref.chapter),
        (41, 2)
    );
}
#[test]
fn meant_corrections_work_across_partial_boundaries() {
    let mut detector = DirectDetector::new();
    assert!(detector.detect("Revelation 20:22").is_empty());
    let repaired = detector.detect("I meant 22 20");
    assert_eq!(repaired.len(), 1);
    assert_eq!(
        (
            repaired[0].verse_ref.chapter,
            repaired[0].verse_ref.verse_start
        ),
        (22, 20)
    );
    let cumulative = detector.detect("Revelation 20:22 I meant 22 20");
    assert_eq!(
        (
            cumulative[0].verse_ref.chapter,
            cumulative[0].verse_ref.verse_start
        ),
        (22, 20)
    );
}
#[test]
fn invalid_bookless_chapters_revoke_previous_chapter_authority() {
    for invalid in ["chapter 30 verse 1", "chapter 30"] {
        let mut detector = DirectDetector::new();
        detector.detect("John 3:16");
        assert!(detector.detect(invalid).is_empty());
        assert!(
            detector.detect("verse 5").is_empty(),
            "stale chapter after {invalid}"
        );
        let repaired = detector.detect("3:5");
        assert_eq!(
            (
                repaired[0].verse_ref.book_number,
                repaired[0].verse_ref.chapter
            ),
            (43, 3)
        );
    }
}
#[test]
fn newly_named_invalid_address_cannot_complete_an_older_pending_book() {
    let mut detector = DirectDetector::new();
    detector.detect("John 3:16");
    assert!(detector.detect("Mark 3").is_empty());
    assert!(detector.detect("Luke 40:1").is_empty());
    let repaired = detector.detect("3:5");
    assert_eq!(
        (
            repaired[0].verse_ref.book_number,
            repaired[0].verse_ref.chapter,
            repaired[0].verse_ref.verse_start
        ),
        (42, 3, 5)
    );
}

#[test]
fn colon_corrections_retain_unmodified_parts_of_the_address() {
    let mut detector = DirectDetector::new();
    let corrected = detector.detect("John 3:16 I meant verse 17");
    assert_eq!(
        (
            corrected[0].verse_ref.chapter,
            corrected[0].verse_ref.verse_start
        ),
        (3, 17)
    );
    let unchanged = detector.detect("John 3:16 sorry");
    assert_eq!(
        (
            unchanged[0].verse_ref.chapter,
            unchanged[0].verse_ref.verse_start
        ),
        (3, 16)
    );
}
