use std::sync::Mutex;
use tauri::State;
use rhema_core::MutexExt;
use rhema_detection::ReadingMode;
use super::types::ReadingModeStatus;

/// Get the current status and position of the reading mode tracker.
#[tauri::command]
pub fn reading_mode_status(
    state: State<'_, Mutex<ReadingMode>>,
) -> Result<ReadingModeStatus, String> {
    let rm = state.lock_safe().map_err(|e| e.to_string())?;
    Ok(ReadingModeStatus {
        active: rm.is_active(),
        current_verse: rm.current_verse(),
    })
}

/// Immediately stop and deactivate the reading mode tracker.
#[tauri::command]
pub fn stop_reading_mode(
    state: State<'_, Mutex<ReadingMode>>,
) -> Result<(), String> {
    let mut rm = state.lock_safe().map_err(|e| e.to_string())?;
    rm.deactivate();
    Ok(())
}
