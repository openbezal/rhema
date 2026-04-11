use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use serde::Serialize;

#[derive(Serialize, Clone)]
struct TranslationSwitch {
    abbreviation: String,
    translation_id: i64,
}

/// Check for voice translation commands like \"read in NIV\".
pub fn check_translation(app: &AppHandle, transcript: &str) {
    let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
    let detector = match detector_state.lock() {
        Ok(d) => d,
        Err(_) => return,
    };

    if let Some(abbrev) = detector.detect_translation_command(transcript) {
        drop(detector);

        let managed: State<'_, Mutex<AppState>> = app.state();
        let mut app_state = match managed.try_lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        if let Some(ref db) = app_state.bible_db {
            if let Ok(translations) = db.list_translations() {
                if let Some(t) = translations.iter().find(|t| t.abbreviation == abbrev) {
                    app_state.active_translation_id = t.id;
                    log::info!("[STT] Voice command: switched to {} (id={})", abbrev, t.id);
                    drop(app_state);

                    let _ = app.emit("translation_command", TranslationSwitch {
                        abbreviation: abbrev,
                        translation_id: t.id,
                    });
                }
            }
        }
    }
}
