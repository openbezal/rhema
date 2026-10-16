use crate::operator_profile::{
    ProfileDb, ProfileReceipt, ProfileRuntime, ProfileSnapshot, ProfileUpdates,
};
use tauri::Manager;

fn require_operator_window(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Operator preferences are available only in the main window".into())
    }
}

#[tauri::command]
pub async fn read_local_profile(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<ProfileSnapshot, String> {
    require_operator_window(window.label())?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ProfileRuntime>()
            .with_profile(&directory, ProfileDb::snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_local_profile(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    expected_revision: u64,
    updates: ProfileUpdates,
) -> Result<ProfileReceipt, String> {
    require_operator_window(window.label())?;
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<ProfileRuntime>()
            .with_profile(&directory, |profile| {
                profile.write(expected_revision, updates)
            })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::require_operator_window;

    #[test]
    fn only_the_actual_operator_window_can_access_local_credentials() {
        assert!(require_operator_window("main").is_ok());
        for label in ["broadcast-main", "broadcast-alt", "main-copy", "", "MAIN"] {
            assert!(require_operator_window(label).is_err());
        }
    }
}
