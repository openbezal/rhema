use super::*;
use rhema_detection::{Detection, DetectionSource, VerseRef};

fn merged(verse_id: Option<i64>, source: DetectionSource) -> MergedDetection {
    MergedDetection {
        auto_queued: false,
        detection: Detection {
            verse_ref: VerseRef {
                book_number: 43,
                book_name: "John".into(),
                chapter: 3,
                verse_start: 16,
                verse_end: None,
            },
            verse_id,
            confidence: 0.75,
            source,
            transcript_snippet: "Fixture quote".into(),
            detected_at: 0,
            is_chapter_only: false,
        },
    }
}
#[test]
fn metadata_provenance_uses_the_resolved_row_not_the_current_selection() {
    let path = std::env::temp_dir().join(format!(
        "rhema-detection-provenance-{}-{:?}.db",
        std::process::id(),
        std::thread::current().id()
    ));
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE translations (id INTEGER, abbreviation TEXT, title TEXT, language TEXT, is_copyrighted INTEGER, is_downloaded INTEGER);
        INSERT INTO translations VALUES(1,'KJV','King James','en',0,1),(7,'ESV','English Standard','en',1,1);
        CREATE TABLE verses(id INTEGER, translation_id INTEGER, book_number INTEGER, book_name TEXT, book_abbreviation TEXT, chapter INTEGER, verse INTEGER, text TEXT);
        INSERT INTO verses VALUES(101,1,43,'John','Jn',3,16,'KJV fixture text'),(707,7,43,'John','Jn',3,16,'ESV fixture text');").unwrap();
    drop(conn);
    let mut state = AppState::new();
    state.active_translation_id = 7;
    state.bible_db = Some(rhema_bible::BibleDb::open(&path).unwrap());
    let vector = serde_json::to_value(to_result(
        &state,
        &merged(Some(101), DetectionSource::Semantic { similarity: 0.75 }),
    ))
    .unwrap();
    assert_eq!(vector["translation_code"], "KJV");
    assert_eq!(vector["translation_id"], 1);
    assert_eq!(vector["score_kind"], "cosine");
    assert_eq!(vector["verse_text"], "KJV fixture text");
    let direct = serde_json::to_value(to_result(
        &state,
        &merged(None, DetectionSource::DirectReference),
    ))
    .unwrap();
    assert_eq!(direct["translation_code"], "ESV");
    assert_eq!(direct["translation_id"], 7);
    drop(state);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn metadata_provenance_does_not_invent_attribution_for_unresolved_text() {
    let result = serde_json::to_value(to_result(
        &AppState::new(),
        &merged(None, DetectionSource::DirectReference),
    ))
    .unwrap();
    assert!(result
        .get("translation_code")
        .is_some_and(serde_json::Value::is_null));
    assert!(result
        .get("translation_id")
        .is_some_and(serde_json::Value::is_null));
}
