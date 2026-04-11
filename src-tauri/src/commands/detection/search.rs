use std::sync::{Arc, Mutex};
use tauri::State;
use rhema_core::{BookId, ChapterNumber, VerseNumber, MutexExt};
use crate::state::AppState;
use super::types::{DetectionResult, SemanticSearchResult, QuotationSearchResult};
use super::mapper::to_result;

/// Run the detection pipeline on a piece of transcript text.
/// Invoke the core detection pipeline for Bible references in the provided text.
#[tauri::command]
pub fn detect_verses(
    state: State<'_, Mutex<AppState>>,
    text: String,
) -> Result<Vec<DetectionResult>, String> {
    let mut app_state = state.lock_safe().map_err(|e| e.to_string())?;
    let merged = app_state.detection_pipeline.process(&text);
    let results: Vec<DetectionResult> = merged.iter().map(|m| to_result(&app_state, m)).collect();
    Ok(results)
}

/// Perform a semantic similarity search against the Bible index.
#[tauri::command]
pub fn semantic_search(
    state: State<'_, Mutex<AppState>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let k = limit.unwrap_or(10);
    let mut app_state = state.lock_safe().map_err(|e| e.to_string())?;

    if !app_state.detection_pipeline.has_semantic() {
        return Err("Semantic search not available — model or embeddings not loaded".into());
    }

    let hits = app_state.detection_pipeline.semantic_search(&query, k);

    let mut results: Vec<SemanticSearchResult> = hits
        .into_iter()
        .filter_map(|(verse_id, similarity)| {
            if let Some(ref db) = app_state.bible_db {
                if let Ok(Some(v)) = db.get_verse_by_id(verse_id) {
                    return Some(SemanticSearchResult {
                        verse_ref: format!("{} {}:{}", v.book_name, v.chapter, v.verse),
                        verse_text: Arc::from(v.text),
                        book_name: Arc::from(v.book_name),
                        book_number: BookId(v.book_number as u8),
                        chapter: ChapterNumber(v.chapter as u16),
                        verse: VerseNumber(v.verse as u16),
                        similarity,
                    });
                }
            }
            None
        })
        .collect();

    // Ensure highest similarity is always first
    results.sort_by(|a, b| b.similarity.partial_cmp(&a.similarity).unwrap_or(std::cmp::Ordering::Equal));

    Ok(results)
}

/// Search for verses using word-overlap quotation matching.
#[tauri::command]
pub fn quotation_search(
    state: State<'_, Mutex<AppState>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<QuotationSearchResult>, String> {
    let k = limit.unwrap_or(10);
    let app_state = state.lock_safe().map_err(|e| e.to_string())?;

    if !app_state.quotation_matcher.is_ready() {
        return Ok(vec![]);
    }

    let detections = app_state.quotation_matcher.match_transcript(&query);

    let results: Vec<QuotationSearchResult> = detections
        .into_iter()
        .take(k)
        .map(|d| {
            let vr = &d.verse_ref;
            let verse_text = if let Some(ref db) = app_state.bible_db {
                db.get_verse(
                    app_state.active_translation_id,
                    vr.book_number,
                    vr.chapter,
                    vr.verse_start,
                )
                .ok()
                .flatten()
                .map(|v| v.text)
                .unwrap_or_default()
            } else {
                String::new()
            };

            QuotationSearchResult {
                verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
                verse_text: Arc::from(verse_text),
                book_name: vr.book_name.clone(),
                book_number: vr.book_number,
                chapter: vr.chapter,
                verse: vr.verse_start,
                similarity: d.confidence,
            }
        })
        .collect();

    Ok(results)
}
