use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State, Manager};
use rhema_detection::{ReadingMode, DetectionVerseRef};
use crate::commands::detection::DetectionResult;

/// Check reading mode: if active, test transcript against expected verse.
pub fn check(app: &AppHandle, transcript: &str, direct_found: bool) {
    if !direct_found {
        check_advancement(app, transcript);
        return;
    }

    let verse_info = {
        let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
        let detector = match detector_state.lock() {
            Ok(d) => d,
            Err(_) => return,
        };
        detector.recent_detections.front().cloned()
    };

    let Some(recent) = verse_info else {
        check_advancement(app, transcript);
        return;
    };

    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
    let should_start = match rm_managed.lock() {
        Ok(rm) => should_start_reading_mode(&rm, &recent, 0.95),
        Err(_) => false,
    };

    if !should_start {
        check_advancement(app, transcript);
        return;
    }

    let chapter_data = {
        let app_managed: State<'_, Mutex<crate::state::AppState>> = app.state();
        let Ok(app_state) = app_managed.try_lock() else { return };
        
        app_state.bible_db.as_ref().and_then(|db| {
            db.get_chapter(app_state.active_translation_id, recent.book_number, recent.chapter).ok()
        })
    };

    if let Some(chapter_verses) = chapter_data {
        let verses: Vec<(i32, String)> = chapter_verses.into_iter().map(|v| (v.verse, v.text)).collect();
        let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
        if let Ok(mut rm) = rm_managed.lock() {
            log::info ! ("[READING] Starting mode for {} {}:{}", recent.book_name, recent.chapter, recent.verse_start);
            rm.start(recent.book_number, &recent.book_name, recent.chapter, recent.verse_start, verses);
        }
    }

    check_advancement(app, transcript);
}

/// Internal helper to check for reading mode progress.
fn check_advancement(app: &AppHandle, transcript: &str) {
    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
    
    let advance = {
        let mut rm = match rm_managed.lock() {
            Ok(rm) => rm,
            Err(_) => return,
        };
        if !rm.is_active() { return; }
        rm.check_transcript(transcript)
    };

    if let Some(advance) = advance {
        log::trace!("[READING] Advanced to verse {}", advance.verse);
        let _ = app.emit("reading_mode_verse", &advance);

        let result = DetectionResult {
            verse_ref: advance.reference.clone(),
            verse_text: advance.verse_text.clone(),
            book_name: advance.book_name.clone(),
            book_number: advance.book_number,
            chapter: advance.chapter,
            verse: advance.verse,
            confidence: advance.confidence,
            source: "contextual".to_string(),
            auto_queued: true,
            transcript_snippet: String::new(),
        };
        let _ = app.emit("verse_detections", &vec![result]);
    }
}

/// Pure predicate to decide if reading mode should start/restart.
fn should_start_reading_mode(rm: &ReadingMode, recent: &DetectionVerseRef, confidence: f64) -> bool {
    if !rm.is_active() {
        return true; // Not active: go ahead
    }
    
    if rm.current_book() == recent.book_number && rm.current_chapter() == recent.chapter {
        return false; // Already tracking
    }
    
    if rm.current_book() != recent.book_number && confidence >= 0.90 {
        return true; // Explicit new book
    }
    
    rm.current_book() == recent.book_number // Same book, different chapter
}

# [ cfg ( test ) ]
mod tests {
    use super::*;
    use rhema_detection::{ReadingMode, DetectionVerseRef};

    # [ test ]
    fn test_should_start_reading_mode() {
        let mut rm = ReadingMode::default();
        let recent = DetectionVerseRef {
            book_number: 1, // Genesis
            book_name: "Genesis".to_string(),
            chapter: 1,
            verse_start: 1,
            verse_end: 1,
            transcript_snippet: String::new(),
            confidence: 0.95,
            verse_id: None,
            source: rhema_detection::DetectionSource::DirectReference,
        };

        // Case 1: Not active
        assert!(should_start_reading_mode(&rm, &recent, 0.95));

        // Case 2: Already active on same chapter
        rm.start(1, "Genesis", 1, 1, vec![(1, "In the beginning".to_string())]);
        assert!(!should_start_reading_mode(&rm, &recent, 0.95));

        // Case 3: Different chapter in same book
        let next_ch = DetectionVerseRef { chapter: 2, ..recent.clone() };
        assert!(should_start_reading_mode(&rm, &next_ch, 0.95));

        // Case 4: Different book, high confidence
        let diff_book = DetectionVerseRef { book_number: 2, ..recent.clone() };
        assert!(should_start_reading_mode(&rm, &diff_book, 0.95));

        // Case 5: Different book, low confidence (should be suppressed)
        assert!(!should_start_reading_mode(&rm, &diff_book, 0.85));
    }

    # [ cfg ( kani ) ]
    mod kani_proofs {
        use super::*;

        #[kani::proof]
        fn proof_reading_mode_start_logic() {
            let rm = ReadingMode::default();
            let recent = DetectionVerseRef {
                book_number: 1,
                book_name: "Gen".to_string(),
                chapter: 1,
                verse_start: 1,
                verse_end: 1,
                transcript_snippet: String::new(),
                confidence: 1.0,
                verse_id: None,
                source: rhema_detection::DetectionSource::DirectReference,
            };
            
            // Should always start if inactive
            assert!(should_start_reading_mode(&rm, &recent, 0.95));
        }

        #[kani::proof]
        fn proof_reading_mode_suppression() {
            let mut rm = ReadingMode::default();
            rm.start(1, "Gen", 1, 1, vec![(1, "Text".into())]);
            
            let recent = DetectionVerseRef {
                book_number: 1,
                chapter: 1,
                confidence: 1.0,
                ..DetectionVerseRef::default()
            };
            
            // Should NOT restart if already tracking same chapter
            assert!(!should_start_reading_mode(&rm, &recent, 1.0));
        }
    }
}
