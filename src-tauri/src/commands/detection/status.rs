use std::sync::Mutex;
use tauri::State;
use rhema_core::MutexExt;
use crate::state::AppState;
use super::types::DetectionStatusResult;

/// Check the current status of the detection engine.
#[tauri::command]
pub fn detection_status(
    state: State<'_, Mutex<AppState>>,
) -> Result<DetectionStatusResult, String> {
    let app_state = state.lock_safe().map_err(|e| e.to_string())?;
    Ok(DetectionStatusResult {
        has_direct: true,
        has_semantic: app_state.detection_pipeline.has_semantic(),
        has_cloud: app_state.detection_pipeline.has_cloud(),
        paraphrase_enabled: app_state.detection_pipeline.use_synonyms(),
    })
}

/// Toggle paraphrase detection (synonym expansion) on or off.
#[tauri::command]
pub fn toggle_paraphrase_detection(
    state: State<'_, Mutex<AppState>>,
    enabled: bool,
) -> Result<bool, String> {
    let mut app_state = state.lock_safe().map_err(|e| e.to_string())?;
    app_state.detection_pipeline.set_use_synonyms(enabled);
    log::info ! ("[DET] Paraphrase detection (synonyms) set to: {enabled}");
    Ok(enabled)
}
