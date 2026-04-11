use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use crate::commands::detection::DetectionResult;
use rhema_detection::QuotationDetection;

/// Run quotation matching against all loaded Bible translations.
pub fn run(app: &AppHandle, transcript: &str) {
    {
        use rhema_detection::ReadingMode;
        let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
        if let Ok(rm) = rm_managed.lock() {
            if rm.is_active() || rm.has_verses() {
                return;
            }
        }
    }

    let managed: State<'_, Mutex<AppState>> = app.state();
    let app_state = match managed.try_lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    if !app_state.quotation_matcher.is_ready() {
        return;
    }

    let detections = app_state.quotation_matcher.match_transcript(transcript);
    if detections.is_empty() {
        return;
    }

    let results: Vec<DetectionResult> = detections
        .iter()
        .map(|d| map_to_result(&app_state, d))
        .collect();

    for r in &results {
        log::info!(
            "[DET-QUOTATION] Found: {} ({:.0}%) auto_q={}",
            r.verse_ref,
            r.confidence * 100.0,
            r.auto_queued
        );
    }

    drop(app_state);
    let _ = app.emit("verse_detections", &results);
}

/// Helper for quotation mapping.
fn map_to_result(app_state: &AppState, d: &QuotationDetection) -> DetectionResult {
    let vr = &d.verse_ref;
    let verse_text = match &app_state.bible_db {
        Some(db) => db.get_verse(app_state.active_translation_id, vr.book_number, vr.chapter, vr.verse_start)
            .ok()
            .flatten()
            .map(|v| v.text)
            .unwrap_or_default(),
        None => String::new(),
    };

    DetectionResult {
        verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
        verse_text,
        book_name: vr.book_name.clone(),
        book_number: vr.book_number,
        chapter: vr.chapter,
        verse: vr.verse_start,
        confidence: d.confidence,
        source: "quotation".to_string(),
        auto_queued: d.confidence >= 0.85,
        transcript_snippet: d.transcript_snippet.clone(),
    }
}
