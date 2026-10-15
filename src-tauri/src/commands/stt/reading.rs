use rhema_detection::{ReadingAdvance, ReadingMode, VerseRef};

type ChapterText = Vec<(i32, String)>;

/// Pure native coordination seam; the caller owns session, database and event effects.
pub(super) fn apply_reading_transcript(
    reading: &mut ReadingMode,
    accepted: Option<&VerseRef>,
    transcript: &str,
    mentioned_books: &[i32],
    mut load_chapter: impl FnMut(i32, i32) -> Option<ChapterText>,
) -> Option<ReadingAdvance> {
    if let Some(reference) = accepted {
        if super::should_start_reading(reading, reference) {
            let verses = load_chapter(reference.book_number, reference.chapter)?;
            if !verses
                .iter()
                .any(|(verse, _)| *verse == reference.verse_start)
            {
                return None;
            }
            reading.start(
                reference.book_number,
                &reference.book_name,
                reference.chapter,
                reference.verse_start,
                verses,
            );
        }
        // The citation/navigation already produced an accepted event. Reinterpreting
        // its raw numbers or "previous verse" command would apply a second intent.
        return None;
    }
    if reading.has_verses()
        && !mentioned_books.is_empty()
        && !mentioned_books.contains(&reading.current_book())
    {
        return None;
    }
    if let Some(change) = reading.check_chapter_command(transcript) {
        let verses = load_chapter(change.book_number, change.new_chapter)?;
        let start = change.start_verse.unwrap_or(1);
        let text = verses
            .iter()
            .find(|(number, _)| *number == start)?
            .1
            .clone();
        reading.start(
            change.book_number,
            &change.book_name,
            change.new_chapter,
            start,
            verses,
        );
        return Some(ReadingAdvance {
            book_number: change.book_number,
            book_name: change.book_name.clone(),
            chapter: change.new_chapter,
            verse: start,
            verse_text: text,
            reference: format!("{} {}:{start}", change.book_name, change.new_chapter),
            confidence: 1.0,
        });
    }
    reading.check_transcript(transcript)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_detection::{DetectionMerger, DirectDetector};

    fn chapter(book: i32, number: i32) -> Option<ChapterText> {
        let end = rhema_detection::direct::versification::max_verse(book, number)?;
        Some(
            (1..=end)
                .map(|verse| (verse, format!("Synthetic verse {verse}")))
                .collect(),
        )
    }
    fn accepted(
        detector: &mut DirectDetector,
        merger: &mut DetectionMerger,
        text: &str,
    ) -> Option<VerseRef> {
        let results = merger
            .merge(detector.detect(text), vec![])
            .into_iter()
            .map(|item| {
                let reference = item.detection.verse_ref;
                crate::commands::detection::DetectionResult {
                    verse_ref: format!(
                        "{} {}:{}",
                        reference.book_name, reference.chapter, reference.verse_start
                    ),
                    verse_text: "Resolved fixture text".into(),
                    book_name: reference.book_name,
                    book_number: reference.book_number,
                    chapter: reference.chapter,
                    verse: reference.verse_start,
                    confidence: item.detection.confidence,
                    source: "direct".into(),
                    auto_queued: item.auto_queued,
                    transcript_snippet: text.into(),
                    is_chapter_only: false,
                }
            })
            .collect::<Vec<_>>();
        super::super::accepted_direct_reference(&results)
    }
    #[test]
    fn accepted_previous_verse_is_consumed_once_after_reading_has_advanced() {
        let mut detector = DirectDetector::new();
        let mut merger = DetectionMerger::new();
        let mut reading = ReadingMode::new();
        let first = accepted(&mut detector, &mut merger, "John 3:16").unwrap();
        apply_reading_transcript(&mut reading, Some(&first), "John 3:16", &[43], chapter);
        let advance =
            apply_reading_transcript(&mut reading, None, "next verse", &[], chapter).unwrap();
        assert_eq!(advance.verse, 17);
        let previous = accepted(&mut detector, &mut merger, "previous verse").unwrap();
        assert_eq!(previous.verse_start, 16);
        let duplicate = apply_reading_transcript(
            &mut reading,
            Some(&previous),
            "previous verse",
            &[],
            chapter,
        );
        assert!(
            duplicate.is_none(),
            "accepted command emitted a second advance: {duplicate:?}"
        );
        assert_eq!(reading.current_verse(), Some(16));
    }
    #[test]
    fn raw_later_citation_cannot_override_the_accepted_passage() {
        let mut detector = DirectDetector::new();
        let mut merger = DetectionMerger::new();
        let mut reading = ReadingMode::new();
        let text = "John 3:16 and Mark chapter 2 verse 5";
        let reference = accepted(&mut detector, &mut merger, text).unwrap();
        assert_eq!(reference.book_number, 43);
        let advance =
            apply_reading_transcript(&mut reading, Some(&reference), text, &[43, 41], chapter);
        assert!(
            advance.is_none(),
            "later citation borrowed accepted book: {advance:?}"
        );
        assert_eq!(
            (
                reading.current_book(),
                reading.current_chapter(),
                reading.current_verse()
            ),
            (43, 3, Some(16))
        );
    }
    #[test]
    fn rejected_named_citation_can_be_repaired_without_reinterpreting_old_reading() {
        let mut detector = DirectDetector::new();
        let mut merger = DetectionMerger::new();
        let mut reading = ReadingMode::new();
        let first = accepted(&mut detector, &mut merger, "John 3:16").unwrap();
        apply_reading_transcript(&mut reading, Some(&first), "John 3:16", &[43], chapter);
        assert!(accepted(&mut detector, &mut merger, "Mark 30:1").is_none());
        assert!(
            apply_reading_transcript(&mut reading, None, "Mark 30:1", &[41], chapter).is_none()
        );
        let corrected = accepted(&mut detector, &mut merger, "3:5").unwrap();
        apply_reading_transcript(&mut reading, Some(&corrected), "3:5", &[], chapter);
        assert_eq!(
            (
                reading.current_book(),
                reading.current_chapter(),
                reading.current_verse()
            ),
            (41, 3, Some(5))
        );
    }
    #[test]
    fn invalid_chapter_command_cannot_fall_back_to_an_old_chapter_verse() {
        let mut reading = ReadingMode::new();
        reading.start(43, "John", 3, 16, chapter(43, 3).unwrap());
        let advance =
            apply_reading_transcript(&mut reading, None, "chapter 30 verse 1", &[], chapter);
        assert!(
            advance.is_none(),
            "invalid chapter emitted old-context verse: {advance:?}"
        );
        assert_eq!(
            (reading.current_chapter(), reading.current_verse()),
            (3, Some(16))
        );
    }
}
