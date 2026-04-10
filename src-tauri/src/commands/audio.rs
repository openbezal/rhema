use std::sync::Mutex;

use tauri::State;

use crate::state::AppState;
use rhema_audio::DeviceInfo;

/// List all available audio input devices.
#[tauri::command]
pub fn get_audio_devices(_state: State<'_, Mutex<AppState>>) -> Result<Vec<DeviceInfo>, String> {
    rhema_audio::device::enumerate_devices().map_err(|e| e.to_string())
}
