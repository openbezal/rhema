use std::{fs, io::ErrorKind, path::Path};

use serde::Serialize;
use serde_json::Value;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblePreferences {
    translation_selection: Option<Value>,
    active_translation_id: Option<Value>,
}

/// Unlike plugin-store's initial load, preserve errors from existing files.
fn read_preferences_file(path: &Path) -> Result<Option<BiblePreferences>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot read Bible preferences: {error}")),
    };
    let values: serde_json::Map<String, Value> = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid Bible preferences: {error}"))?;
    Ok(Some(BiblePreferences {
        translation_selection: values.get("translationSelection").cloned(),
        active_translation_id: values.get("activeTranslationId").cloned(),
    }))
}

/// Reads only the fixed Bible preference file in this application's data directory.
#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri extracts an owned AppHandle for commands"
)]
pub fn read_bible_preferences(app: tauri::AppHandle) -> Result<Option<BiblePreferences>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_preferences_file(&directory.join("bible.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new(name: &str) -> Self {
            let directory = std::env::temp_dir().join(format!(
                "rhema-bible-preferences-{}-{name}",
                std::process::id()
            ));
            fs::create_dir_all(&directory).unwrap();
            Self(directory)
        }
        fn path(&self) -> PathBuf {
            self.0.join("bible.json")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn missing_preferences_are_a_fresh_install() {
        let fixture = Fixture::new("missing");
        assert!(read_preferences_file(&fixture.path()).unwrap().is_none());
    }

    #[test]
    fn malformed_preferences_are_not_a_fresh_install() {
        let fixture = Fixture::new("malformed");
        fs::write(fixture.path(), b"{\"activeTranslationId\":").unwrap();
        assert!(read_preferences_file(&fixture.path()).is_err());
        assert_eq!(
            fs::read(fixture.path()).unwrap(),
            b"{\"activeTranslationId\":"
        );
    }

    #[test]
    fn unreadable_preferences_are_not_a_fresh_install() {
        let fixture = Fixture::new("unreadable");
        fs::create_dir(fixture.path()).unwrap();
        assert!(read_preferences_file(&fixture.path()).is_err());
    }

    #[test]
    fn preferences_must_be_a_json_object() {
        let fixture = Fixture::new("shape");
        for invalid in ["null", "[]", "42", "\"KJV\""] {
            fs::write(fixture.path(), invalid).unwrap();
            assert!(read_preferences_file(&fixture.path()).is_err());
        }
    }

    #[test]
    fn checked_read_returns_only_selection_fields() {
        let fixture = Fixture::new("valid");
        fs::write(fixture.path(), r#"{"translationSelection":{"version":1,"code":"ESV"},"activeTranslationId":2,"other":"ignored"}"#).unwrap();
        let preferences = read_preferences_file(&fixture.path()).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(preferences).unwrap(),
            serde_json::json!({
                "translationSelection": {"version": 1, "code": "ESV"}, "activeTranslationId": 2,
            })
        );
    }
}
