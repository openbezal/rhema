#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::Mutex;
use serde::Serialize;
use tauri::State;

use crate::state::AppState;
use rhema_bible::{Book, CrossReference, Translation, Verse};

#[tauri::command]
pub fn list_translations(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<Translation>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.list_translations().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_books(
    state: State<'_, Mutex<AppState>>,
    translation_id: i64,
) -> Result<Vec<Book>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.list_books(translation_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_chapter(
    state: State<'_, Mutex<AppState>>,
    translation_id: i64,
    book_number: i32,
    chapter: i32,
) -> Result<Vec<Verse>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.get_chapter(translation_id, book_number, chapter)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_verse(
    state: State<'_, Mutex<AppState>>,
    translation_id: i64,
    book_number: i32,
    chapter: i32,
    verse: i32,
) -> Result<Option<Verse>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.get_verse(translation_id, book_number, chapter, verse)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_verses(
    state: State<'_, Mutex<AppState>>,
    query: String,
    translation_id: i64,
    limit: usize,
) -> Result<Vec<Verse>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.search_verses(&query, translation_id, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_cross_references(
    state: State<'_, Mutex<AppState>>,
    book_number: i32,
    chapter: i32,
    verse: i32,
) -> Result<Vec<CrossReference>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;
    db.get_cross_references(book_number, chapter, verse)
        .map_err(|e| e.to_string())
}

/// Get the active translation ID
#[tauri::command]
pub fn get_active_translation(
    state: State<'_, Mutex<AppState>>,
) -> Result<i64, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    Ok(app_state.active_translation_id)
}

/// Set the active translation by ID
#[tauri::command]
pub fn set_active_translation(
    state: State<'_, Mutex<AppState>>,
    translation_id: i64,
) -> Result<i64, String> {
    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    // Verify the translation exists
    if let Some(ref db) = app_state.bible_db {
        let translations = db.list_translations().map_err(|e| e.to_string())?;
        if !translations.iter().any(|t| t.id == translation_id) {
            return Err(format!("Translation ID {translation_id} not found"));
        }
    }
    app_state.active_translation_id = translation_id;
    log::info!("[BIBLE] Active translation set to ID {translation_id}");
    Ok(translation_id)
}

#[derive(Serialize)]
pub struct VerseSearchRow {
    pub book_number: i32,
    pub book_name: String,
    pub chapter: i32,
    pub verse: i32,
    pub text: String,
}

#[tauri::command]
pub fn get_translation_verses_for_search(
    state: State<'_, Mutex<AppState>>,
    translation_id: i64,
) -> Result<Vec<VerseSearchRow>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let db = app_state
        .bible_db
        .as_ref()
        .ok_or_else(|| "Bible database not loaded".to_string())?;

    db.load_translation_verses_for_search(translation_id)
        .map(|rows| {
            rows.into_iter()
                .map(|v| VerseSearchRow {
                    book_number: v.book_number,
                    book_name: v.book_name,
                    chapter: v.chapter,
                    verse: v.verse,
                    text: v.text,
                })
                .collect()
        })
        .map_err(|e| e.to_string())
}
