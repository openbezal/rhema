use std::{
    fs::{self, OpenOptions},
    io::ErrorKind,
    path::Path,
    sync::Mutex,
    time::Duration,
};

use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::document_files::{read_json_document, MAX_DOCUMENT_BYTES};

const PROFILE_VERSION: u32 = 1;
const MAX_SAFE_REVISION: u64 = 9_007_199_254_740_991;
type Values = Map<String, Value>;

#[derive(Debug, Serialize)]
pub struct ProfileSections {
    pub settings: Values,
    pub bible: Values,
    pub broadcast: Values,
}

#[derive(Debug, Serialize)]
pub struct ProfileSnapshot {
    pub version: u32,
    pub revision: u64,
    pub sections: ProfileSections,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileUpdates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<Values>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bible: Option<Values>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub broadcast: Option<Values>,
}

#[derive(Debug, Serialize)]
pub struct ProfileReceipt {
    pub version: u32,
    pub revision: u64,
    pub sections: ProfileUpdates,
}

pub struct ProfileDb {
    connection: Connection,
}

impl ProfileDb {
    pub fn open(directory: &Path) -> Result<Self, String> {
        fs::create_dir_all(directory).map_err(|error| error.to_string())?;
        let path = directory.join("operator-profile.sqlite3");
        let mut create = OpenOptions::new();
        create.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            create.mode(0o600);
        }
        match create.open(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("Cannot create operator profile: {error}")),
        }
        let mut connection = Connection::open(&path).map_err(|error| error.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(|error| error.to_string())?;
        let existing_version: u32 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if existing_version != 0 && existing_version != PROFILE_VERSION {
            return Err(format!(
                "Unsupported operator profile version {existing_version}"
            ));
        }
        // Inspect before configuring the connection: an older app must leave a
        // future profile's storage policy alone. New SQLite files use DELETE.
        let journal: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if matches!(journal.to_ascii_lowercase().as_str(), "off" | "memory") {
            return Err("Operator profile requires a durable journal mode".into());
        }
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let version: u32 = transaction
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if version == 0 {
            let tables: i64 = transaction.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", [], |row| row.get(0)).map_err(|error| error.to_string())?;
            if tables != 0 {
                return Err("Unrecognized operator profile schema".into());
            }
            // Read all sources before inserting anything. A failed migration is
            // retried from the unchanged legacy files on the next open.
            let sections = [
                (
                    "settings",
                    read_legacy_section(&directory.join("settings.json"))?,
                ),
                ("bible", read_legacy_section(&directory.join("bible.json"))?),
                (
                    "broadcast",
                    read_legacy_section(&directory.join("broadcast-themes.json"))?,
                ),
            ];
            transaction.execute_batch("CREATE TABLE profile_sections (section TEXT PRIMARY KEY CHECK (section IN ('settings','bible','broadcast')), value TEXT NOT NULL CHECK (json_valid(value) AND json_type(value) = 'object')); CREATE TABLE profile_meta (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), revision INTEGER NOT NULL CHECK (revision >= 0)); INSERT INTO profile_meta VALUES (1,0); PRAGMA user_version = 1;").map_err(|error| error.to_string())?;
            for (section, values) in sections {
                let json = serde_json::to_string(&values).map_err(|error| error.to_string())?;
                transaction
                    .execute(
                        "INSERT INTO profile_sections(section,value) VALUES (?1,?2)",
                        params![section, json],
                    )
                    .map_err(|error| error.to_string())?;
            }
        } else if version != PROFILE_VERSION {
            return Err(format!("Unsupported operator profile version {version}"));
        }
        read_snapshot(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(Self { connection })
    }

    pub fn snapshot(&mut self) -> Result<ProfileSnapshot, String> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let snapshot = read_snapshot(&transaction)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(snapshot)
    }

    pub fn write(
        &mut self,
        expected_revision: u64,
        updates: ProfileUpdates,
    ) -> Result<ProfileReceipt, String> {
        let encoded: Vec<(&str, String)> = [
            ("settings", updates.settings.as_ref()),
            ("bible", updates.bible.as_ref()),
            ("broadcast", updates.broadcast.as_ref()),
        ]
        .into_iter()
        .filter_map(|(name, values)| values.map(|values| (name, values)))
        .map(|(name, values)| {
            let json = serde_json::to_string(values).map_err(|error| error.to_string())?;
            if json.len() > MAX_DOCUMENT_BYTES {
                return Err(format!("Profile {name} section exceeds the 64 MiB limit"));
            }
            Ok((name, json))
        })
        .collect::<Result<_, String>>()?;
        if encoded.is_empty() {
            return Err("No profile changes supplied".into());
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = checked_revision(&transaction)?;
        if current != expected_revision {
            return Err("Preferences changed. Reload before retrying.".into());
        }
        let next = current
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_REVISION)
            .ok_or("Operator profile revision limit reached")?;
        for (name, json) in encoded {
            transaction
                .execute(
                    "UPDATE profile_sections SET value = ?1 WHERE section = ?2",
                    params![json, name],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "UPDATE profile_meta SET revision = ?1 WHERE singleton = 1",
                [next],
            )
            .map_err(|error| error.to_string())?;
        // Returning before commit would falsely acknowledge failed persistence.
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(ProfileReceipt {
            version: PROFILE_VERSION,
            revision: next,
            sections: updates,
        })
    }
}

fn read_legacy_section(path: &Path) -> Result<Values, String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Values::new()),
        Err(error) => return Err(format!("Cannot inspect legacy preferences: {error}")),
        Ok(_) => {}
    }
    let document = read_json_document(path)?;
    decode_object(&document.text, "Legacy preferences")
}

fn decode_object(json: &str, context: &str) -> Result<Values, String> {
    let value: Value = serde_json::from_str(json).map_err(|_| format!("Invalid {context} JSON"))?;
    match value {
        Value::Object(values) => Ok(values),
        _ => Err(format!("{context} must be a JSON object")),
    }
}

fn checked_revision(connection: &Connection) -> Result<u64, String> {
    let version: u32 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version != PROFILE_VERSION {
        return Err(format!("Unsupported operator profile version {version}"));
    }
    let revision: u64 = connection
        .query_row(
            "SELECT revision FROM profile_meta WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if revision > MAX_SAFE_REVISION {
        return Err("Invalid operator profile revision".into());
    }
    let count: i64 = connection
        .query_row("SELECT count(*) FROM profile_sections", [], |row| {
            row.get(0)
        })
        .map_err(|error| error.to_string())?;
    if count != 3 {
        return Err("Operator profile sections are incomplete".into());
    }
    Ok(revision)
}

fn read_snapshot(connection: &Connection) -> Result<ProfileSnapshot, String> {
    let revision = checked_revision(connection)?;
    let section = |name: &str| -> Result<Values, String> {
        let json: String = connection
            .query_row(
                "SELECT value FROM profile_sections WHERE section = ?1",
                [name],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if json.len() > MAX_DOCUMENT_BYTES {
            return Err(format!("Profile {name} section exceeds the 64 MiB limit"));
        }
        decode_object(&json, &format!("Profile {name} section"))
    };
    Ok(ProfileSnapshot {
        version: PROFILE_VERSION,
        revision,
        sections: ProfileSections {
            settings: section("settings")?,
            bible: section("bible")?,
            broadcast: section("broadcast")?,
        },
    })
}

#[derive(Default)]
pub struct ProfileRuntime(Mutex<Option<ProfileDb>>);
impl ProfileRuntime {
    pub fn with_profile<T>(
        &self,
        directory: &Path,
        action: impl FnOnce(&mut ProfileDb) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut profile = self.0.lock().map_err(|error| error.to_string())?;
        if profile.is_none() {
            *profile = Some(ProfileDb::open(directory)?);
        }
        let database = profile.as_mut().ok_or("Operator profile unavailable")?;
        action(database)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Map, Value};
    use std::fs;

    fn object(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(values) => values,
            _ => panic!("test fixture must be an object"),
        }
    }

    #[test]
    fn fresh_install_has_three_empty_sections_and_zero_revision() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        let snapshot = serde_json::to_value(profile.snapshot().unwrap()).unwrap();
        assert_eq!(
            snapshot,
            json!({"version":1,"revision":0,"sections":{"settings":{},"bible":{},"broadcast":{}}})
        );
    }

    #[test]
    fn migration_preserves_unicode_local_credentials_provenance_and_original_files() {
        let directory = tempfile::tempdir().unwrap();
        let files = [
            ("settings.json", "{\"gain\":1.5,\"deepgramApiKey\":\"FAKE-SECRET\",\"futureKey\":true}"),
            ("bible.json", "{\"translationSelection\":{\"version\":1,\"code\":\"BIUO\",\"catalog\":{\"BIUO\":10}}}"),
            ("broadcast-themes.json", "{\"customThemes\":[{\"name\":\"Ọlọ́run — Chineke\"}],\"outputs\":[{\"monitorIndex\":2}]}"),
        ];
        for (name, content) in files {
            fs::write(directory.path().join(name), content).unwrap();
        }
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        let snapshot = serde_json::to_value(profile.snapshot().unwrap()).unwrap();
        assert_eq!(
            snapshot["sections"]["settings"],
            json!({"gain":1.5,"deepgramApiKey":"FAKE-SECRET","futureKey":true})
        );
        assert_eq!(
            snapshot["sections"]["bible"]["translationSelection"]["code"],
            "BIUO"
        );
        assert_eq!(
            snapshot["sections"]["broadcast"]["customThemes"][0]["name"],
            "Ọlọ́run — Chineke"
        );
        for (name, content) in files {
            assert_eq!(
                fs::read_to_string(directory.path().join(name)).unwrap(),
                content
            );
        }
        drop(profile);
        fs::write(directory.path().join("settings.json"), "{\"gain\":9}").unwrap();
        let mut reopened = ProfileDb::open(directory.path()).unwrap();
        assert_eq!(
            serde_json::to_value(reopened.snapshot().unwrap()).unwrap()["sections"]["settings"]
                ["gain"],
            1.5
        );
    }

    #[test]
    fn failed_legacy_migration_is_all_or_nothing_and_retryable() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("settings.json"), "{\"gain\":1.5}").unwrap();
        fs::write(directory.path().join("bible.json"), "{\"incomplete\":").unwrap();
        assert!(ProfileDb::open(directory.path()).is_err());
        assert_eq!(
            fs::read_to_string(directory.path().join("bible.json")).unwrap(),
            "{\"incomplete\":"
        );
        fs::write(directory.path().join("settings.json"), "{\"gain\":2}").unwrap();
        fs::write(
            directory.path().join("bible.json"),
            "{\"translationSelection\":{\"version\":1,\"code\":\"KJV\"}}",
        )
        .unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        assert_eq!(
            serde_json::to_value(profile.snapshot().unwrap()).unwrap()["sections"]["settings"]
                ["gain"],
            2
        );
    }

    #[test]
    fn legacy_files_must_be_regular_utf8_json_objects() {
        for bytes in [b"[]".as_slice(), b"null", b"42", b"{\"key\":\"\xff\"}"] {
            let directory = tempfile::tempdir().unwrap();
            fs::write(directory.path().join("settings.json"), bytes).unwrap();
            assert!(ProfileDb::open(directory.path()).is_err());
        }
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("settings.json")).unwrap();
        assert!(ProfileDb::open(directory.path()).is_err());
    }

    #[test]
    fn section_write_preserves_other_sections_and_advances_revision_after_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        let receipt = profile
            .write(
                0,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":2}))),
                    ..ProfileUpdates::default()
                },
            )
            .unwrap();
        assert_eq!(serde_json::to_value(receipt).unwrap()["revision"], 1);
        drop(profile);
        let mut reopened = ProfileDb::open(directory.path()).unwrap();
        assert_eq!(
            serde_json::to_value(reopened.snapshot().unwrap()).unwrap(),
            json!({"version":1,"revision":1,"sections":{"settings":{"gain":2},"bible":{},"broadcast":{}}})
        );
    }

    #[test]
    fn mid_transaction_failure_keeps_all_sections_and_revision_after_reopen() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        profile
            .write(
                0,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":1}))),
                    bible: Some(object(json!({"code":"KJV"}))),
                    broadcast: None,
                },
            )
            .unwrap();
        profile.connection.execute_batch("CREATE TRIGGER reject_bible BEFORE UPDATE ON profile_sections WHEN NEW.section = 'bible' BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;").unwrap();
        assert!(profile
            .write(
                1,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":2}))),
                    bible: Some(object(json!({"code":"BIUO"}))),
                    broadcast: None
                }
            )
            .is_err());
        drop(profile);
        let mut reopened = ProfileDb::open(directory.path()).unwrap();
        let snapshot = serde_json::to_value(reopened.snapshot().unwrap()).unwrap();
        assert_eq!(snapshot["revision"], 1);
        assert_eq!(snapshot["sections"]["settings"]["gain"], 1);
        assert_eq!(snapshot["sections"]["bible"]["code"], "KJV");
    }

    #[test]
    fn stale_or_empty_writes_never_change_profile() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        profile
            .write(
                0,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":1}))),
                    ..ProfileUpdates::default()
                },
            )
            .unwrap();
        assert!(profile
            .write(
                0,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":2}))),
                    ..ProfileUpdates::default()
                }
            )
            .is_err());
        assert!(profile.write(1, ProfileUpdates::default()).is_err());
        let snapshot = serde_json::to_value(profile.snapshot().unwrap()).unwrap();
        assert_eq!(snapshot["revision"], 1);
        assert_eq!(snapshot["sections"]["settings"]["gain"], 1);
    }

    #[test]
    fn future_or_corrupt_canonical_database_never_falls_back_to_legacy() {
        let directory = tempfile::tempdir().unwrap();
        let profile = ProfileDb::open(directory.path()).unwrap();
        profile
            .connection
            .pragma_update(None, "user_version", 99)
            .unwrap();
        drop(profile);
        fs::write(directory.path().join("settings.json"), "{\"gain\":9}").unwrap();
        assert!(ProfileDb::open(directory.path()).is_err());
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("operator-profile.sqlite3"),
            "not SQLite",
        )
        .unwrap();
        fs::write(directory.path().join("settings.json"), "{\"gain\":9}").unwrap();
        assert!(ProfileDb::open(directory.path()).is_err());
    }

    #[test]
    fn rejecting_a_future_database_does_not_change_its_journal_mode() {
        let directory = tempfile::tempdir().unwrap();
        let profile = ProfileDb::open(directory.path()).unwrap();
        profile
            .connection
            .pragma_update(None, "user_version", 99)
            .unwrap();
        profile
            .connection
            .pragma_update(None, "journal_mode", "WAL")
            .unwrap();
        drop(profile);
        assert!(ProfileDb::open(directory.path()).is_err());
        let connection =
            Connection::open(directory.path().join("operator-profile.sqlite3")).unwrap();
        let journal: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(journal.to_ascii_lowercase(), "wal");
    }

    #[test]
    fn legacy_structure_errors_do_not_echo_credentials() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("settings.json"),
            "\"FAKE-SECRET-ROOT\"",
        )
        .unwrap();
        let error = ProfileDb::open(directory.path()).err().unwrap();
        assert!(!error.contains("FAKE-SECRET-ROOT"));
    }

    #[test]
    fn corrupt_section_errors_do_not_echo_credentials() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        profile
            .connection
            .pragma_update(None, "ignore_check_constraints", true)
            .unwrap();
        profile
            .connection
            .execute(
                "UPDATE profile_sections SET value = ?1 WHERE section = 'settings'",
                ["\"FAKE-SECRET-ROOT\""],
            )
            .unwrap();
        let error = profile.snapshot().err().unwrap();
        assert!(!error.contains("FAKE-SECRET-ROOT"));
    }

    #[test]
    fn oversized_legacy_file_is_rejected_before_migration() {
        let directory = tempfile::tempdir().unwrap();
        fs::File::create(directory.path().join("settings.json"))
            .unwrap()
            .set_len(MAX_DOCUMENT_BYTES as u64 + 1)
            .unwrap();
        assert!(ProfileDb::open(directory.path()).is_err());
    }

    #[test]
    fn oversized_section_write_leaves_previous_profile_unchanged() {
        let directory = tempfile::tempdir().unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        let updates = ProfileUpdates {
            settings: Some(object(json!({"large": "x".repeat(MAX_DOCUMENT_BYTES)}))),
            ..ProfileUpdates::default()
        };
        assert!(profile.write(0, updates).is_err());
        let snapshot = serde_json::to_value(profile.snapshot().unwrap()).unwrap();
        assert_eq!(snapshot["revision"], 0);
        assert_eq!(snapshot["sections"]["settings"], json!({}));
    }

    #[test]
    fn a_small_setting_write_does_not_return_unchanged_theme_images() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("broadcast-themes.json"),
            r#"{"image":"UNCHANGED-IMAGE-PAYLOAD"}"#,
        )
        .unwrap();
        let mut profile = ProfileDb::open(directory.path()).unwrap();
        let receipt = profile
            .write(
                0,
                ProfileUpdates {
                    settings: Some(object(json!({"gain":2}))),
                    ..ProfileUpdates::default()
                },
            )
            .unwrap();
        let json = serde_json::to_value(receipt).unwrap();
        assert_eq!(json["sections"], json!({"settings":{"gain":2}}));
        assert_eq!(
            serde_json::to_value(profile.snapshot().unwrap()).unwrap()["sections"]["broadcast"]
                ["image"],
            "UNCHANGED-IMAGE-PAYLOAD"
        );
    }

    #[cfg(unix)]
    #[test]
    fn new_profile_database_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let _profile = ProfileDb::open(directory.path()).unwrap();
        assert_eq!(
            fs::metadata(directory.path().join("operator-profile.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
