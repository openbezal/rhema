//! Per-chapter verse counts for validating that a cited verse actually exists
//! (e.g. "Revelation 20:22" is impossible — Revelation 20 ends at verse 15).
//!
//! The table is the union max across all bundled translations, generated from
//! `data/rhema.db`:
//!
//! ```sql
//! SELECT book_number, chapter, MAX(verse) FROM verses GROUP BY 1,2 ORDER BY 1,2
//! ```
//!
//! clamped to the canonical 1,189 chapters (drops Joel 4, which exists only in
//! Hebrew-numbering translations and is rejected by chapter validation anyway).
//! Union max means a verse valid in *any* bundled translation passes; the
//! app layer drops detections whose verse is missing from the *active*
//! translation. Regenerate this table when translations are added or changed.

/// Max verse number per chapter, indexed by book number (1-66), then by
/// `chapter - 1`. Index 0 is unused.
const MAX_VERSES: [&[u16]; 67] = [
    &[], // 0 unused
    &[31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 33, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26], // 1 Genesis
    &[22, 25, 22, 31, 23, 30, 29, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 37, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38], // 2 Exodus
    &[17, 16, 17, 35, 26, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34], // 3 Leviticus
    &[54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 28, 32, 22, 29, 35, 41, 30, 25, 19, 65, 23, 31, 40, 17, 54, 42, 56, 29, 34, 13], // 4 Numbers
    &[46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 19, 29, 23, 22, 20, 22, 21, 20, 23, 30, 26, 22, 19, 19, 26, 69, 29, 20, 30, 52, 29, 12], // 5 Deuteronomy
    &[18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33], // 6 Joshua
    &[36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25], // 7 Judges
    &[22, 23, 18, 22], // 8 Ruth
    &[28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 16, 23, 29, 23, 44, 25, 12, 25, 11, 31, 13], // 9 1 Samuel
    &[27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 44, 26, 22, 51, 39, 25], // 10 2 Samuel
    &[53, 46, 28, 34, 32, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 54], // 11 1 Kings
    &[18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 22, 25, 29, 39, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30], // 12 2 Kings
    &[54, 55, 24, 43, 41, 81, 40, 40, 44, 14, 47, 41, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30], // 13 1 Chronicles
    &[18, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 23, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23], // 14 2 Chronicles
    &[11, 70, 13, 24, 17, 22, 28, 36, 15, 44], // 15 Ezra
    &[11, 20, 38, 23, 19, 19, 73, 18, 38, 40, 36, 47, 31], // 16 Nehemiah
    &[22, 23, 15, 17, 14, 14, 10, 17, 32, 3], // 17 Esther
    &[22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 32, 34, 17], // 18 Job
    &[6, 12, 9, 9, 13, 11, 18, 10, 21, 18, 7, 9, 6, 7, 5, 11, 15, 51, 15, 10, 14, 32, 6, 10, 22, 12, 14, 9, 11, 13, 25, 11, 22, 23, 28, 13, 40, 23, 14, 18, 14, 12, 5, 27, 18, 12, 10, 15, 21, 23, 21, 11, 7, 9, 24, 14, 12, 12, 18, 14, 9, 13, 12, 11, 14, 20, 8, 36, 37, 6, 24, 20, 28, 23, 11, 13, 21, 72, 13, 20, 17, 8, 19, 13, 14, 17, 7, 19, 53, 17, 16, 16, 5, 23, 11, 13, 12, 9, 9, 5, 8, 29, 22, 35, 45, 48, 43, 14, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 14, 10, 8, 12, 15, 21, 10, 20, 14, 9, 6], // 19 Psalms
    &[33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31], // 20 Proverbs
    &[18, 26, 22, 17, 20, 12, 29, 17, 18, 20, 10, 14], // 21 Ecclesiastes
    &[17, 17, 11, 16, 16, 13, 14, 14], // 22 Song of Solomon
    &[31, 22, 26, 6, 30, 13, 25, 23, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24], // 23 Isaiah
    &[19, 37, 25, 31, 31, 30, 34, 23, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34], // 24 Jeremiah
    &[22, 22, 66, 22, 22], // 25 Lamentations
    &[28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 37, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35], // 26 Ezekiel
    &[21, 49, 33, 37, 31, 29, 28, 27, 27, 21, 45, 13], // 27 Daniel
    &[11, 25, 5, 19, 15, 11, 16, 14, 17, 15, 12, 15, 16, 10], // 28 Hosea
    &[20, 32, 21], // 29 Joel
    &[15, 16, 15, 13, 27, 14, 17, 14, 15], // 30 Amos
    &[21], // 31 Obadiah
    &[17, 11, 10, 11], // 32 Jonah
    &[16, 13, 12, 14, 15, 16, 20], // 33 Micah
    &[15, 14, 19], // 34 Nahum
    &[17, 20, 19], // 35 Habakkuk
    &[18, 15, 20], // 36 Zephaniah
    &[15, 23], // 37 Haggai
    &[21, 17, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21], // 38 Zechariah
    &[14, 17, 24, 6], // 39 Malachi
    &[25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20], // 40 Matthew
    &[45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20], // 41 Mark
    &[80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53], // 42 Luke
    &[51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25], // 43 John
    &[26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31], // 44 Acts
    &[32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27], // 45 Romans
    &[31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24], // 46 1 Corinthians
    &[24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14], // 47 2 Corinthians
    &[24, 21, 29, 31, 26, 18], // 48 Galatians
    &[23, 22, 21, 32, 33, 24], // 49 Ephesians
    &[30, 30, 21, 23], // 50 Philippians
    &[29, 23, 25, 18], // 51 Colossians
    &[10, 20, 13, 18, 28], // 52 1 Thessalonians
    &[12, 17, 18], // 53 2 Thessalonians
    &[20, 15, 16, 16, 25, 21], // 54 1 Timothy
    &[18, 26, 17, 22], // 55 2 Timothy
    &[16, 15, 15], // 56 Titus
    &[25], // 57 Philemon
    &[14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25], // 58 Hebrews
    &[27, 26, 18, 17, 20], // 59 James
    &[25, 25, 22, 19, 14], // 60 1 Peter
    &[21, 22, 18], // 61 2 Peter
    &[10, 29, 24, 21, 21], // 62 1 John
    &[13], // 63 2 John
    &[15], // 64 3 John
    &[25], // 65 Jude
    &[20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 18, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21], // 66 Revelation
];

/// The last verse number of the given chapter, or `None` when the book or
/// chapter is out of range.
pub fn max_verse(book_number: i32, chapter: i32) -> Option<i32> {
    if !(1..=66).contains(&book_number) || chapter < 1 {
        return None;
    }
    #[expect(clippy::cast_sign_loss, reason = "book_number validated to be 1..=66")]
    let chapters = MAX_VERSES[book_number as usize];
    #[expect(clippy::cast_sign_loss, reason = "chapter validated to be >= 1")]
    chapters.get(chapter as usize - 1).map(|&v| i32::from(v))
}

/// Check that a book/chapter/verse combination exists in at least one
/// bundled translation.
pub fn is_valid_verse(book_number: i32, chapter: i32, verse: i32) -> bool {
    match max_verse(book_number, chapter) {
        Some(max) => verse >= 1 && verse <= max,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_revelation_20_ends_at_verse_15() {
        assert_eq!(max_verse(66, 20), Some(15));
        assert!(!is_valid_verse(66, 20, 22)); // the issue #141 incident
        assert!(is_valid_verse(66, 20, 15));
        assert!(is_valid_verse(66, 22, 21)); // last verse of the Bible
        assert!(!is_valid_verse(66, 22, 22));
    }

    #[test]
    fn test_known_chapter_lengths() {
        assert_eq!(max_verse(19, 119), Some(176)); // Psalm 119
        assert_eq!(max_verse(43, 3), Some(36)); // John 3
        assert_eq!(max_verse(1, 1), Some(31)); // Genesis 1
    }

    #[test]
    fn test_out_of_range() {
        assert_eq!(max_verse(0, 1), None);
        assert_eq!(max_verse(67, 1), None);
        assert_eq!(max_verse(66, 0), None);
        assert_eq!(max_verse(66, 23), None); // Revelation has 22 chapters
        assert!(!is_valid_verse(66, 20, 0));
        assert!(!is_valid_verse(-1, 1, 1));
    }

    #[test]
    fn test_table_shape() {
        assert!(MAX_VERSES[0].is_empty());
        let total: usize = MAX_VERSES.iter().map(|c| c.len()).sum();
        assert_eq!(total, 1189);
        // Every chapter must have at least one verse.
        for (book, chapters) in MAX_VERSES.iter().enumerate().skip(1) {
            assert!(!chapters.is_empty(), "book {book} has no chapters");
            for (i, &v) in chapters.iter().enumerate() {
                assert!(v >= 1, "book {book} chapter {} has zero verses", i + 1);
            }
        }
    }
}
