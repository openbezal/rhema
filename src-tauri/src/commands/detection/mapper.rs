use std::sync::Arc;
use rhema_core::{BookId, ChapterNumber, VerseNumber};
use rhema_detection::MergedDetection;
use crate::state::AppState;
use super::types::DetectionResult;

pub fn source_to_string(source: &rhema_detection::DetectionSource) -> String {
    match source {
        rhema_detection::DetectionSource::DirectReference => "direct".to_string(),
        rhema_detection::DetectionSource::Contextual => "contextual".to_string(),
        rhema_detection::DetectionSource::QuotationMatch { .. } => "quotation".to_string(),
        rhema_detection::DetectionSource::SemanticLocal { .. } => "semantic_local".to_string(),
        rhema_detection::DetectionSource::SemanticCloud { .. } => "semantic_cloud".to_string(),
        _ => "unknown".to_string(),
    }
}

pub fn to_result(state: &AppState, merged: &MergedDetection) -> DetectionResult {
    let vr = &merged.detection.verse_ref;
    let vid = merged.detection.verse_id;

    // Resolve verse info: try verse_id first (semantic), then book/chapter/verse (direct)
    let (reference, verse_text, book_name, book_number, chapter, verse) =
        if let (Some(id), Some(ref db)) = (vid, &state.bible_db) {
            // Semantic detection: resolve via DB primary key
            if let Ok(Some(v)) = db.get_verse_by_id(id) {
                let r = format!("{} {}:{}", v.book_name, v.chapter, v.verse);
                (r, Arc::from(v.text), Arc::from(v.book_name), BookId(v.book_number as u8), ChapterNumber(v.chapter as u16), VerseNumber(v.verse as u16))
            } else {
                let r = format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start);
                (r, Arc::from(""), vr.book_name.clone(), vr.book_number, vr.chapter, vr.verse_start)
            }
        } else if let Some(ref db) = state.bible_db {
            // Direct detection: resolve via book/chapter/verse
            if vr.book_number.0 > 0 && vr.chapter.0 > 0 && vr.verse_start.0 > 0 {
                if let Ok(Some(v)) = db.get_verse(state.active_translation_id, vr.book_number.0 as i32, vr.chapter.0 as i32, vr.verse_start.0 as i32) {
                    let r = format!("{} {}:{}", v.book_name, v.chapter, v.verse);
                    (r, Arc::from(v.text), Arc::from(v.book_name), BookId(v.book_number as u8), ChapterNumber(v.chapter as u16), VerseNumber(v.verse as u16))
                } else {
                    let r = format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start);
                    (r, Arc::from(""), vr.book_name.clone(), vr.book_number, vr.chapter, vr.verse_start)
                }
            } else {
                let r = format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start);
                (r, Arc::from(""), vr.book_name.clone(), vr.book_number, vr.chapter, vr.verse_start)
            }
        } else {
            let r = format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start);
            (r, Arc::from(""), vr.book_name.clone(), vr.book_number, vr.chapter, vr.verse_start)
        };

    DetectionResult {
        verse_ref: reference,
        verse_text,
        book_name,
        book_number,
        chapter,
        verse,
        confidence: merged.detection.confidence,
        source: source_to_string(&merged.detection.source),
        auto_queued: merged.auto_queued,
        transcript_snippet: merged.detection.transcript_snippet.clone(),
    }
}
