use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiblePreferences {
    translation_selection: Option<Value>,
    active_translation_id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    follow_detections: Option<bool>,
}

fn preferences_from_section(values: &Map<String, Value>) -> Option<BiblePreferences> {
    if values.is_empty() {
        return None;
    }
    Some(BiblePreferences {
        translation_selection: values.get("translationSelection").cloned(),
        active_translation_id: values.get("activeTranslationId").cloned(),
        follow_detections: values.get("followDetections").and_then(Value::as_bool),
    })
}

/// Preserve the stable selection API while reading the checked canonical profile.
#[tauri::command]
pub async fn read_bible_preferences(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<BiblePreferences>, String> {
    let profile = super::profile::read_local_profile(app, window).await?;
    Ok(preferences_from_section(&profile.sections.bible))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    fn read_preferences_file(path: &Path) -> Result<Option<BiblePreferences>, String> {
        let mut profile = crate::operator_profile::ProfileDb::open(path.parent().unwrap())?;
        Ok(preferences_from_section(
            &profile.snapshot()?.sections.bible,
        ))
    }

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

    #[test]
    fn checked_read_also_restores_the_saved_follow_preference() {
        let fixture = Fixture::new("follow");
        fs::write(
            fixture.path(),
            r#"{"translationSelection":{"version":1,"code":"BIUO"},"followDetections":true}"#,
        )
        .unwrap();
        let preferences = read_preferences_file(&fixture.path()).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(preferences).unwrap()["followDetections"],
            true
        );
    }

    #[test]
    fn canonical_bible_selection_takes_precedence_over_preserved_legacy_json() {
        let fixture = Fixture::new("canonical");
        fs::write(
            fixture.path(),
            r#"{"translationSelection":{"version":1,"code":"KJV"}}"#,
        )
        .unwrap();
        let mut profile = crate::operator_profile::ProfileDb::open(&fixture.0).unwrap();
        profile
            .write(
                0,
                crate::operator_profile::ProfileUpdates {
                    bible: Some(
                        serde_json::json!({"translationSelection":{"version":1,"code":"BIUO"}})
                            .as_object()
                            .unwrap()
                            .clone(),
                    ),
                    ..crate::operator_profile::ProfileUpdates::default()
                },
            )
            .unwrap();
        let preferences = read_preferences_file(&fixture.path()).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(preferences).unwrap()["translationSelection"]["code"],
            "BIUO"
        );
    }
}
