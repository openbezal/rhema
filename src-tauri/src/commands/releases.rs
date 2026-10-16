use crate::release_notice::{fetch_latest, ReleaseNotice, ReleaseNoticeRuntime};
use tauri::{AppHandle, State, WebviewWindow};

fn require_main(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Release notices are available only in the operator window".into())
    }
}

#[tauri::command]
pub async fn check_release_notice(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, ReleaseNoticeRuntime>,
    retry: bool,
) -> Result<ReleaseNotice, String> {
    require_main(window.label())?;
    let current = app.package_info().version.to_string();
    Ok(state.check(retry, || fetch_latest(&current)).await)
}

#[tauri::command]
pub async fn claim_release_notice(
    window: WebviewWindow,
    state: State<'_, ReleaseNoticeRuntime>,
) -> Result<bool, String> {
    require_main(window.label())?;
    Ok(state.claim().await)
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_the_main_operator_window_can_check_or_claim_notices() {
        assert!(super::require_main("main").is_ok());
        for window in ["broadcast-main", "broadcast-other", "MAIN", ""] {
            assert!(super::require_main(window).is_err());
        }
    }
}
