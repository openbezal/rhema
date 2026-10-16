use std::{collections::HashSet, sync::atomic::Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{
    operator_profile::{ProfileDb, ProfileReceipt, ProfileUpdates},
    state::AppState,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableSettings {
    pub gain: f64,
    pub auto_mode: bool,
    pub confidence_threshold: f64,
    pub cooldown_ms: u32,
    pub suggestion_capacity: u32,
    pub suggestion_retention_ms: u32,
    pub stt_provider: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortableRestore {
    pub settings: PortableSettings,
    pub primary_translation_code: String,
    pub secondary_translation_code: Option<String>,
    pub follow_detections: bool,
    pub auto_live: bool,
    pub custom_themes: Vec<Map<String, Value>>,
}

#[derive(Serialize)]
pub struct ProfileApplyReceipt {
    pub profile: ProfileReceipt,
    pub primary_translation_id: i64,
    pub primary_translation_code: String,
    pub secondary_translation_code: Option<String>,
}

fn validate_settings(settings: &PortableSettings) -> Result<(), String> {
    if !settings.gain.is_finite()
        || !(0.0..=2.0).contains(&settings.gain)
        || !settings.confidence_threshold.is_finite()
        || !(0.0..=1.0).contains(&settings.confidence_threshold)
        || settings.cooldown_ms > 60_000
        || !(1..=100).contains(&settings.suggestion_capacity)
        || !(1000..=300_000).contains(&settings.suggestion_retention_ms)
        || !matches!(settings.stt_provider.as_str(), "deepgram" | "whisper")
    {
        return Err("Portable settings contain unsupported values".into());
    }
    Ok(())
}

fn merge_imported_themes(
    current: Option<&Value>,
    imported: Vec<Map<String, Value>>,
) -> Result<Value, String> {
    let mut themes = match current {
        None => Vec::new(),
        Some(Value::Array(themes)) => themes.clone(),
        Some(_) => {
            return Err("Current custom themes are unreadable; repair them before importing".into())
        }
    };
    if themes.len().saturating_add(imported.len()) > 1000 {
        return Err("Keep at most 1000 custom themes after importing".into());
    }
    let mut ids: HashSet<String> = themes
        .iter()
        .filter_map(|theme| theme.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    for theme in imported {
        let id = theme
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Imported theme has no identity")?;
        let name = theme
            .get("name")
            .and_then(Value::as_str)
            .ok_or("Imported theme has no name")?;
        if !id.starts_with("import-")
            || id.len() > 512
            || name.trim().is_empty()
            || name.len() > 2048
            || theme.get("builtin") != Some(&Value::Bool(false))
            || !ids.insert(id.to_owned())
        {
            return Err("Imported themes need unique new identities and valid names".into());
        }
        themes.push(Value::Object(theme));
    }
    Ok(Value::Array(themes))
}

/// The caller holds session→AppState→profile locks. No fallible step follows
/// the durable commit before publishing the matching native translation ID.
pub fn apply_preferences(
    profile: &mut ProfileDb,
    state: &mut AppState,
    expected_revision: u64,
    input: PortableRestore,
) -> Result<ProfileApplyReceipt, String> {
    if state.audio_test_active.load(Ordering::SeqCst) {
        return Err("Stop the audio test before applying preferences".into());
    }
    validate_settings(&input.settings)?;
    let translations = state
        .bible_db
        .as_ref()
        .ok_or("Bible database is unavailable")?
        .list_translations()
        .map_err(|error| error.to_string())?;
    let resolve = |code: &str| {
        let code = code.trim().to_ascii_uppercase();
        let matching: Vec<_> = translations
            .iter()
            .filter(|item| {
                item.is_downloaded && item.abbreviation.trim().eq_ignore_ascii_case(&code)
            })
            .collect();
        if matching.len() != 1 {
            return Err(format!(
                "Choose an available unambiguous Bible translation for {code}"
            ));
        }
        Ok((matching[0].id, code))
    };
    let (primary_id, primary_code) = resolve(&input.primary_translation_code)?;
    let secondary_code = input
        .secondary_translation_code
        .as_deref()
        .map(resolve)
        .transpose()?
        .map(|(_, code)| code);
    if secondary_code.as_ref() == Some(&primary_code) {
        return Err("Choose a different secondary translation or None".into());
    }
    let previous = profile.snapshot()?;
    if previous.revision != expected_revision {
        return Err("Preferences changed. Review them again before applying.".into());
    }
    let mut settings = previous.sections.settings;
    let portable = serde_json::to_value(input.settings).map_err(|error| error.to_string())?;
    settings.extend(
        portable
            .as_object()
            .ok_or("Invalid portable settings")?
            .clone(),
    );
    let mut bible = previous.sections.bible;
    let catalog: Map<String, Value> = translations
        .iter()
        .filter(|item| item.is_downloaded)
        .map(|item| {
            (
                item.abbreviation.trim().to_ascii_uppercase(),
                json!(item.id),
            )
        })
        .collect();
    let mut selection = json!({"version":1,"code":primary_code,"catalog":catalog});
    if let Some(code) = &secondary_code {
        selection["secondaryCode"] = json!(code);
    }
    bible.insert("translationSelection".into(), selection);
    bible.insert("followDetections".into(), json!(input.follow_detections));
    bible.remove("activeTranslationId");
    let mut broadcast = previous.sections.broadcast;
    broadcast.insert(
        "customThemes".into(),
        merge_imported_themes(broadcast.get("customThemes"), input.custom_themes)?,
    );
    broadcast.insert("autoLive".into(), json!(input.auto_live));
    let receipt = profile.write(
        expected_revision,
        ProfileUpdates {
            settings: Some(settings),
            bible: Some(bible),
            broadcast: Some(broadcast),
        },
    )?;
    state.active_translation_id = primary_id;
    Ok(ProfileApplyReceipt {
        profile: receipt,
        primary_translation_id: primary_id,
        primary_translation_code: primary_code,
        secondary_translation_code: secondary_code,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{operator_profile::ProfileDb, state::AppState};
    use serde_json::{json, Value};
    use std::fs;

    fn fixture() -> (tempfile::TempDir, ProfileDb, AppState) {
        fixture_with_catalog_change("")
    }

    fn fixture_with_catalog_change(extra: &str) -> (tempfile::TempDir, ProfileDb, AppState) {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("settings.json"), r#"{"deepgramApiKey":"FAKE-LOCAL","audioDeviceId":"local-microphone","onboardingComplete":true,"unknownLocal":42,"gain":1}"#).unwrap();
        fs::write(directory.path().join("bible.json"), r#"{"translationSelection":{"version":1,"code":"KJV","catalog":{"KJV":7}},"followDetections":false}"#).unwrap();
        fs::write(directory.path().join("broadcast-themes.json"), r#"{"customThemes":[{"id":"local-theme","name":"Local","builtin":false}],"outputs":[{"id":"main","monitorIndex":3,"themeId":"local-theme"}],"activeThemeId":"local-theme","autoLive":false}"#).unwrap();
        let corpus = directory.path().join("corpus.sqlite3");
        let connection = rusqlite::Connection::open(&corpus).unwrap();
        connection.execute_batch("CREATE TABLE translations(id INTEGER,abbreviation TEXT,title TEXT,language TEXT,is_copyrighted INTEGER,is_downloaded INTEGER); INSERT INTO translations VALUES(7,'KJV','King James','en',0,1),(10,'BIUO','Igbo','ig',1,1),(8,'OYCB','Yoruba','yo',1,1);").unwrap();
        connection.execute_batch(extra).unwrap();
        drop(connection);
        let profile = ProfileDb::open(directory.path()).unwrap();
        let mut state = AppState::new();
        state.bible_db = Some(rhema_bible::BibleDb::open(&corpus).unwrap());
        state.active_translation_id = 7;
        (directory, profile, state)
    }

    fn restore() -> PortableRestore {
        serde_json::from_value(json!({
            "settings":{"gain":1.8,"autoMode":false,"confidenceThreshold":0.85,"cooldownMs":2000,"suggestionCapacity":40,"suggestionRetentionMs":90000,"sttProvider":"whisper"},
            "primaryTranslationCode":"BIUO","secondaryTranslationCode":"OYCB",
            "followDetections":true,"autoLive":true,
            "customThemes":[{"id":"import-new","name":"Chineke Ọlọ́run","builtin":false}]
        })).unwrap()
    }

    fn snapshot(profile: &mut ProfileDb) -> Value {
        serde_json::to_value(profile.snapshot().unwrap()).unwrap()
    }

    #[test]
    fn applies_all_portable_sections_and_native_identity_without_replacing_local_bindings() {
        let (directory, mut profile, mut state) = fixture();
        let before = snapshot(&mut profile);
        let receipt = apply_preferences(&mut profile, &mut state, 0, restore()).unwrap();
        assert_eq!(receipt.primary_translation_id, 10);
        assert_eq!(state.active_translation_id, 10);
        let after = snapshot(&mut profile);
        assert_eq!(after["revision"], 1);
        for key in [
            "deepgramApiKey",
            "audioDeviceId",
            "onboardingComplete",
            "unknownLocal",
        ] {
            assert_eq!(
                after["sections"]["settings"][key],
                before["sections"]["settings"][key]
            );
        }
        assert_eq!(after["sections"]["settings"]["gain"], 1.8);
        assert_eq!(
            after["sections"]["bible"]["translationSelection"]["code"],
            "BIUO"
        );
        assert_eq!(
            after["sections"]["bible"]["translationSelection"]["catalog"]["BIUO"],
            10
        );
        assert_eq!(
            after["sections"]["bible"]["translationSelection"]["secondaryCode"],
            "OYCB"
        );
        assert_eq!(after["sections"]["bible"]["followDetections"], true);
        assert_eq!(
            after["sections"]["broadcast"]["outputs"],
            before["sections"]["broadcast"]["outputs"]
        );
        assert_eq!(
            after["sections"]["broadcast"]["activeThemeId"],
            "local-theme"
        );
        assert_eq!(after["sections"]["broadcast"]["autoLive"], true);
        assert_eq!(
            after["sections"]["broadcast"]["customThemes"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        drop(profile);
        assert_eq!(
            snapshot(&mut ProfileDb::open(directory.path()).unwrap()),
            after
        );
    }

    #[test]
    fn a_real_mid_transaction_failure_preserves_native_identity_and_every_section() {
        let (directory, mut profile, mut state) = fixture();
        let before = snapshot(&mut profile);
        let connection =
            rusqlite::Connection::open(directory.path().join("operator-profile.sqlite3")).unwrap();
        connection.execute_batch("CREATE TRIGGER refuse_bible BEFORE UPDATE ON profile_sections WHEN OLD.section = 'bible' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
        drop(connection);
        assert!(apply_preferences(&mut profile, &mut state, 0, restore()).is_err());
        assert_eq!(state.active_translation_id, 7);
        assert_eq!(snapshot(&mut profile), before);
        drop(profile);
        assert_eq!(
            snapshot(&mut ProfileDb::open(directory.path()).unwrap()),
            before
        );
    }

    #[test]
    fn missing_database_unknown_or_same_secondary_and_stale_revision_do_not_mutate() {
        for case in [
            "database",
            "primary",
            "secondary",
            "same",
            "stale",
            "gain",
            "theme",
        ] {
            let (_directory, mut profile, mut state) = fixture();
            let before = snapshot(&mut profile);
            let mut input = restore();
            match case {
                "database" => state.bible_db = None,
                "primary" => input.primary_translation_code = "MISSING".into(),
                "secondary" => input.secondary_translation_code = Some("MISSING".into()),
                "same" => input.secondary_translation_code = Some("BIUO".into()),
                "gain" => input.settings.gain = f64::NAN,
                "theme" => {
                    input.custom_themes[0].insert("id".into(), json!("local-theme"));
                }
                _ => {}
            }
            assert!(
                apply_preferences(&mut profile, &mut state, u64::from(case == "stale"), input)
                    .is_err(),
                "{case}"
            );
            assert_eq!(snapshot(&mut profile), before, "{case}");
            assert_eq!(state.active_translation_id, 7, "{case}");
        }
    }

    #[test]
    fn none_removes_an_old_optional_language_and_duplicates_are_refused() {
        let (_directory, mut profile, mut state) = fixture();
        apply_preferences(&mut profile, &mut state, 0, restore()).unwrap();
        let mut input = restore();
        input.secondary_translation_code = None;
        input.custom_themes.clear();
        apply_preferences(&mut profile, &mut state, 1, input).unwrap();
        assert!(
            snapshot(&mut profile)["sections"]["bible"]["translationSelection"]
                .get("secondaryCode")
                .is_none()
        );
        let mut duplicate = restore();
        duplicate
            .custom_themes
            .push(duplicate.custom_themes[0].clone());
        assert!(apply_preferences(&mut profile, &mut state, 2, duplicate).is_err());
        assert_eq!(snapshot(&mut profile)["revision"], 2);
    }

    #[test]
    fn ambiguous_or_not_downloaded_editions_never_apply() {
        for change in [
            "INSERT INTO translations VALUES(11,'biuo','Ambiguous','ig',1,1);",
            "UPDATE translations SET is_downloaded = 0 WHERE abbreviation = 'BIUO';",
        ] {
            let (_directory, mut profile, mut state) = fixture_with_catalog_change(change);
            let before = snapshot(&mut profile);
            assert!(apply_preferences(&mut profile, &mut state, 0, restore()).is_err());
            assert_eq!(snapshot(&mut profile), before);
            assert_eq!(state.active_translation_id, 7);
        }
    }

    #[test]
    fn unsupported_settings_and_active_audio_test_leave_everything_unchanged() {
        for case in [
            "gain",
            "threshold",
            "cooldown",
            "capacity",
            "retention",
            "provider",
            "audio",
        ] {
            let (_directory, mut profile, mut state) = fixture();
            let before = snapshot(&mut profile);
            let mut input = restore();
            match case {
                "gain" => input.settings.gain = 2.01,
                "threshold" => input.settings.confidence_threshold = -0.1,
                "cooldown" => input.settings.cooldown_ms = 60_001,
                "capacity" => input.settings.suggestion_capacity = 0,
                "retention" => input.settings.suggestion_retention_ms = 999,
                "provider" => input.settings.stt_provider = "unsupported".into(),
                "audio" => state.audio_test_active.store(true, Ordering::SeqCst),
                _ => unreachable!(),
            }
            assert!(
                apply_preferences(&mut profile, &mut state, 0, input).is_err(),
                "{case}"
            );
            assert_eq!(snapshot(&mut profile), before, "{case}");
            assert_eq!(state.active_translation_id, 7, "{case}");
        }
    }
}
