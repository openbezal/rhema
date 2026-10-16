use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

use serde::{de::IgnoredAny, Deserialize, Serialize};

pub const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocumentFormat {
    Json,
    Text,
}

impl DocumentFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Text => "txt",
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ImportedDocument {
    pub name: String,
    pub text: String,
}

pub fn validate_document(content: &str, format: DocumentFormat) -> Result<(), String> {
    if content.len() > MAX_DOCUMENT_BYTES {
        return Err("Document exceeds the 64 MiB limit".into());
    }
    if matches!(format, DocumentFormat::Json) {
        // Syntax checking does not need a second in-memory copy of the document tree.
        serde_json::from_str::<IgnoredAny>(content)
            .map_err(|error| format!("Invalid JSON document: {error}"))?;
    }
    Ok(())
}

/// Stage and sync in the same directory before replacing the destination.
/// The rename is atomic; directory durability across power loss is not promised.
pub fn save_document_at(
    destination: &Path,
    content: &str,
    format: DocumentFormat,
) -> Result<(), String> {
    validate_document(content, format)?;
    write_atomic_with(destination, |file| file.write_all(content.as_bytes()))
        .map_err(|error| format!("Cannot save document: {error}"))
}

fn write_atomic_with(
    destination: &Path,
    write: impl FnOnce(&mut File) -> io::Result<()>,
) -> io::Result<()> {
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut staging = tempfile::NamedTempFile::new_in(parent)?;
    write(staging.as_file_mut())?;
    staging.as_file_mut().flush()?;
    staging.as_file().sync_all()?;
    staging.persist(destination).map_err(|error| error.error)?;
    Ok(())
}

pub fn read_json_document(path: &Path) -> Result<ImportedDocument, String> {
    let read = || -> Result<ImportedDocument, String> {
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("Choose a regular JSON file".into());
        }
        if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
            return Err("Document exceeds the 64 MiB limit".into());
        }
        let file = File::open(path).map_err(|error| error.to_string())?;
        if !file
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("Choose a regular JSON file".into());
        }
        // Do not trust the earlier size: a selected file may grow during reading.
        let mut bytes = Vec::new();
        file.take(MAX_DOCUMENT_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err("Document exceeds the 64 MiB limit".into());
        }
        let text = String::from_utf8(bytes).map_err(|error| format!("Invalid UTF-8: {error}"))?;
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        validate_document(text, DocumentFormat::Json)?;
        Ok(ImportedDocument {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            text: text.into(),
        })
    };
    read().map_err(|error| format!("Cannot import document: {error}"))
}

/// A portable dialog suggestion, never a path supplied by the webview.
pub fn suggested_file_name(raw: &str, format: DocumentFormat) -> String {
    let extension = format.extension();
    let trimmed = raw.trim().trim_end_matches(['.', ' ']);
    let stem = trimmed
        .rsplit_once('.')
        .filter(|(_, suffix)| suffix.eq_ignore_ascii_case(extension))
        .map_or(trimmed, |(stem, _)| stem);
    let mut name: String = stem
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    name = name.trim_matches(['.', ' ']).into();
    let device = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || device.strip_prefix("COM").is_some_and(is_device_digit)
        || device.strip_prefix("LPT").is_some_and(is_device_digit)
    {
        name.insert(0, '_');
    }
    while name.len() > 180 {
        name.pop();
    }
    let name = name.trim_end_matches(['.', ' ']);
    let name = if name.is_empty() {
        "rhema-export"
    } else {
        name
    };
    format!("{name}.{extension}")
}

fn is_device_digit(suffix: &str) -> bool {
    matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};

    #[test]
    fn replaces_existing_document_with_exact_unicode_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("archive.json");
        fs::write(&destination, "previous export").unwrap();
        let content = "{\"text\":\"Ọlọ́run — Chineke — Allah\"}\n";
        save_document_at(&destination, content, DocumentFormat::Json).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), content.as_bytes());
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn partial_write_failure_preserves_previous_file_and_removes_staging() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("archive.txt");
        fs::write(&destination, "previous complete export").unwrap();
        let result = write_atomic_with(&destination, |file| {
            file.write_all(b"partial new export")?;
            Err(std::io::Error::other("injected disk failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"previous complete export");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rename_failure_preserves_destination_and_removes_staging() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("occupied.json");
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("keep"), "original").unwrap();
        assert!(save_document_at(&destination, "{}", DocumentFormat::Json).is_err());
        assert_eq!(fs::read(destination.join("keep")).unwrap(), b"original");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn malformed_json_never_replaces_previous_export() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("archive.json");
        fs::write(&destination, "{}").unwrap();
        assert!(save_document_at(&destination, "{\"incomplete\":", DocumentFormat::Json).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"{}");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn oversized_export_is_rejected_before_mutating_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("archive.txt");
        fs::write(&destination, "keep").unwrap();
        let content = "x".repeat(MAX_DOCUMENT_BYTES + 1);
        assert!(save_document_at(&destination, &content, DocumentFormat::Text).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"keep");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn text_export_preserves_newlines_and_needs_no_json() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("sermon.txt");
        save_document_at(&destination, "Ọlọ́run\r\nChineke\n", DocumentFormat::Text).unwrap();
        assert_eq!(
            fs::read_to_string(destination).unwrap(),
            "Ọlọ́run\r\nChineke\n"
        );
    }

    #[test]
    fn json_read_accepts_bom_and_returns_only_name_and_exact_text() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Ọlọ́run.json");
        fs::write(&path, "\u{feff}{\"name\":\"Chineke\"}\n").unwrap();
        let imported = read_json_document(&path).unwrap();
        assert_eq!(
            serde_json::to_value(imported).unwrap(),
            serde_json::json!({
                "name": "Ọlọ́run.json", "text": "{\"name\":\"Chineke\"}\n"
            })
        );
    }

    #[test]
    fn json_read_rejects_invalid_utf8_without_replacement_characters() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("invalid.json");
        fs::write(&path, b"{\"name\":\"\xff\"}").unwrap();
        assert!(read_json_document(&path).is_err());
    }

    #[test]
    fn json_read_rejects_malformed_documents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("invalid.json");
        fs::write(&path, "{\"partial\":").unwrap();
        assert!(read_json_document(&path).is_err());
    }

    #[test]
    fn json_read_rejects_oversized_and_nonregular_files() {
        let directory = tempfile::tempdir().unwrap();
        assert!(read_json_document(directory.path()).is_err());
        let path = directory.path().join("large.json");
        fs::File::create(&path)
            .unwrap()
            .set_len(MAX_DOCUMENT_BYTES as u64 + 1)
            .unwrap();
        assert!(read_json_document(&path).is_err());
    }

    #[test]
    fn unknown_document_formats_are_rejected() {
        assert!(serde_json::from_str::<DocumentFormat>("\"html\"").is_err());
    }

    #[test]
    fn dialog_default_names_are_portable_and_keep_unicode() {
        for (input, expected) in [
            ("Ọlọ́run Chineke", "Ọlọ́run Chineke.json"),
            ("CON", "_CON.json"),
            ("lpt9.JSON", "_lpt9.json"),
            ("A/B\\C:<>|?*\nx", "A_B_C_______x.json"),
            (" ... ", "rhema-export.json"),
            (" sermon.json. ", "sermon.json"),
        ] {
            assert_eq!(
                suggested_file_name(input, DocumentFormat::Json),
                expected,
                "{input:?}"
            );
        }
        let name = suggested_file_name(&"Ọ".repeat(300), DocumentFormat::Text);
        assert!(name.len() <= 184);
        assert_eq!(Path::new(&name).extension().unwrap(), "txt");
        assert!(!name.contains('\u{fffd}'));
    }
}
