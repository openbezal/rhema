#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use rhema_detection::fusion::{
    fuse_rrf, FtsCandidate, VerseKey, FTS5_CONFIDENCE_DECAY, FTS5_MIN_CONFIDENCE,
    FTS5_RANK0_CONFIDENCE,
};
use rhema_detection::{DetectionPipeline, MergedDetection, ReadingMode};

use crate::state::AppState;

/// Serializable detection result for the frontend
#[derive(Clone, Serialize)]
pub struct DetectionResult {
    pub verse_ref: String,
    pub verse_text: String,
    pub book_name: String,
    pub book_number: i32,
    pub chapter: i32,
    pub verse: i32,
    pub confidence: f64,
    pub source: String,
    pub auto_queued: bool,
    pub transcript_snippet: String,
    /// True when detected from a chapter-only reference (verse defaults to 1, may be refined).
    pub is_chapter_only: bool,
}

fn source_to_string(source: &rhema_detection::DetectionSource) -> String {
    match source {
        rhema_detection::DetectionSource::DirectReference => "direct".to_string(),
        rhema_detection::DetectionSource::Semantic { .. } => "semantic".to_string(),
    }
}

/// Resolve a detection to a full verse result using the database.
///
/// Resolution order:
/// 1. By `verse_id` (semantic detections with DB primary key)
/// 2. By `book_number/chapter/verse_start` with active translation (direct + FTS5 detections)
/// 3. Fallback to unresolved VerseRef fields (no DB available)
pub fn to_result(state: &AppState, merged: &MergedDetection) -> DetectionResult {
    let vr = &merged.detection.verse_ref;
    let vid = merged.detection.verse_id;

    let resolved = state.bible_db.as_ref().and_then(|db| {
        // Try verse_id first (vector-based semantic detections)
        if let Some(id) = vid {
            if let Ok(Some(v)) = db.get_verse_by_id(id) {
                return Some(v);
            }
        }
        // Fall back to book/chapter/verse lookup (direct + FTS5 detections)
        if vr.book_number > 0 && vr.chapter > 0 && vr.verse_start > 0 {
            if let Ok(Some(v)) = db.get_verse(state.active_translation_id, vr.book_number, vr.chapter, vr.verse_start) {
                return Some(v);
            }
        }
        None
    });

    let (reference, verse_text, book_name, book_number, chapter, verse) = match resolved {
        Some(v) => {
            let r = format!("{} {}:{}", v.book_name, v.chapter, v.verse);
            (r, v.text, v.book_name, v.book_number, v.chapter, v.verse)
        }
        None => {
            let r = format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start);
            (r, String::new(), vr.book_name.clone(), vr.book_number, vr.chapter, vr.verse_start)
        }
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
        is_chapter_only: merged.detection.is_chapter_only,
    }
}

/// Run the detection pipeline on a piece of transcript text
#[tauri::command]
pub fn detect_verses(
    state: State<'_, Mutex<AppState>>,
    pipeline_state: State<'_, Mutex<DetectionPipeline>>,
    text: String,
) -> Result<Vec<DetectionResult>, String> {
    let merged = {
        let mut pipeline = pipeline_state.lock().map_err(|e| e.to_string())?;
        pipeline.process(&text)
    };
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let results: Vec<DetectionResult> = merged.iter().map(|m| to_result(&app_state, m)).collect();
    Ok(results)
}

/// Check if semantic search is available
#[tauri::command]
pub fn detection_status(
    pipeline_state: State<'_, Mutex<DetectionPipeline>>,
) -> Result<DetectionStatusResult, String> {
    let pipeline = pipeline_state.lock().map_err(|e| e.to_string())?;
    Ok(DetectionStatusResult {
        has_direct: true,
        has_semantic: pipeline.has_semantic(),
        paraphrase_enabled: pipeline.use_synonyms(),
    })
}

/// Toggle paraphrase detection (synonym expansion) on/off
#[tauri::command]
pub fn toggle_paraphrase_detection(
    pipeline_state: State<'_, Mutex<DetectionPipeline>>,
    enabled: bool,
) -> Result<bool, String> {
    let mut pipeline = pipeline_state.lock().map_err(|e| e.to_string())?;
    pipeline.set_use_synonyms(enabled);
    log::info!("[DET] Paraphrase detection (synonyms) set to: {enabled}");
    Ok(enabled)
}

#[derive(Serialize)]
pub struct DetectionStatusResult {
    pub has_direct: bool,
    pub has_semantic: bool,
    pub paraphrase_enabled: bool,
}

#[derive(Clone, Serialize)]
pub struct SemanticSearchResult {
    pub verse_ref: String,
    pub verse_text: String,
    pub book_name: String,
    pub book_number: i32,
    pub chapter: i32,
    pub verse: i32,
    pub similarity: f64,
    /// Which engines found this verse: "semantic", "keyword", or both.
    pub sources: Vec<String>,
}

#[tauri::command]
pub fn semantic_search(
    state: State<'_, Mutex<AppState>>,
    pipeline_state: State<'_, Mutex<DetectionPipeline>>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SemanticSearchResult>, String> {
    let k = limit.unwrap_or(10);
    // Fetch deeper candidate lists than the display limit: RRF rewards
    // agreement between engines, so both lists need enough depth for the
    // overlap to surface.
    let depth = (3 * k).max(30);

    // Lock pipeline for vector search (may be slow if ONNX runs)
    let vector_results = {
        let mut pipeline = pipeline_state.lock().map_err(|e| e.to_string())?;
        if !pipeline.has_semantic() {
            return Err("Semantic search not available — model or embeddings not loaded".into());
        }
        pipeline.semantic_search(&query, depth)
    }; // Pipeline lock dropped

    // Lock AppState for DB lookups only (fast)
    let app_state = state.lock().map_err(|e| e.to_string())?;

    let vector_hits: Vec<(VerseKey, f64)> = vector_results
        .into_iter()
        .filter_map(|(verse_id, similarity)| {
            let db = app_state.bible_db.as_ref()?;
            let v = db.get_verse_by_id(verse_id).ok().flatten()?;
            Some((
                VerseKey { book_number: v.book_number, chapter: v.chapter, verse: v.verse },
                similarity,
            ))
        })
        .collect();

    // FTS5 BM25 across all English translations
    let fts_candidates: Vec<FtsCandidate> = app_state
        .bible_db
        .as_ref()
        .and_then(|db| db.search_verses_bm25(&query, depth).ok())
        .unwrap_or_default()
        .iter()
        .map(|f| {
            (
                VerseKey { book_number: f.book_number, chapter: f.chapter, verse: f.verse },
                f.phrase_match,
            )
        })
        .collect();

    // Rank with verbatim-first fusion, then resolve each hit to the active
    // translation's text.
    #[expect(clippy::cast_precision_loss, reason = "rank is small")]
    let results: Vec<SemanticSearchResult> = fuse_rrf(&vector_hits, &fts_candidates, k)
        .into_iter()
        .enumerate()
        .filter_map(|(fts_rank, hit)| {
            let db = app_state.bible_db.as_ref()?;
            let v = db
                .get_verse(
                    app_state.active_translation_id,
                    hit.key.book_number,
                    hit.key.chapter,
                    hit.key.verse,
                )
                .ok()
                .flatten()?;

            let mut sources = Vec::with_capacity(2);
            if hit.cosine.is_some() {
                sources.push("semantic".to_string());
            }
            if hit.from_fts {
                sources.push("keyword".to_string());
            }

            // Display value only — ordering is the RRF score. Semantic hits
            // show their real cosine; keyword-only hits keep the legacy
            // rank-derived confidence until the UI grows source badges.
            let similarity = hit.cosine.unwrap_or_else(|| {
                (FTS5_RANK0_CONFIDENCE - fts_rank as f64 * FTS5_CONFIDENCE_DECAY)
                    .max(FTS5_MIN_CONFIDENCE)
            });

            Some(SemanticSearchResult {
                verse_ref: format!("{} {}:{}", v.book_name, v.chapter, v.verse),
                verse_text: v.text,
                book_name: v.book_name,
                book_number: v.book_number,
                chapter: v.chapter,
                verse: v.verse,
                similarity,
                sources,
            })
        })
        .collect();

    Ok(results)
}

/// Get reading mode status
#[tauri::command]
pub fn reading_mode_status(
    state: State<'_, Mutex<ReadingMode>>,
) -> Result<ReadingModeStatus, String> {
    let rm = state.lock().map_err(|e| e.to_string())?;
    Ok(ReadingModeStatus {
        active: rm.is_active(),
        current_verse: rm.current_verse(),
    })
}

#[derive(Serialize)]
pub struct ReadingModeStatus {
    pub active: bool,
    pub current_verse: Option<i32>,
}

/// Stop reading mode
#[tauri::command]
pub fn stop_reading_mode(
    state: State<'_, Mutex<ReadingMode>>,
) -> Result<(), String> {
    let mut rm = state.lock().map_err(|e| e.to_string())?;
    rm.deactivate();
    Ok(())
}
