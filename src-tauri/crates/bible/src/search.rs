use std::collections::HashSet;
use std::sync::LazyLock;

use rusqlite::Connection;

use crate::db::BibleDb;
use crate::error::BibleError;
use crate::models::{Book, Verse};

/// A verse with its BM25 relevance rank from FTS5 full-text search.
/// Deduplicated across translations — one entry per unique verse reference.
pub struct Bm25Result {
    /// BM25 rank (negative; more negative = more relevant).
    pub rank: f64,
    pub book_number: i32,
    pub book_name: String,
    pub chapter: i32,
    pub verse: i32,
    /// True when the verse matched the exact-phrase tier — the query text
    /// appears verbatim in the verse. Near-certain relevance for quoted
    /// scripture; fusion gives these hits priority.
    pub phrase_match: bool,
}

// ── Stop words ──────────────────────────────────────────────────────

/// Common English stop words that match nearly every Bible verse.
/// Filtering these keeps AND queries fast (~5-20ms instead of 200-1300ms).
///
/// Deliberately NOT filtered: negations ("not", "no"), quantifiers ("all"),
/// question words ("who", "what", "which", "when", "how"), modals ("will",
/// "shall", "should", "may", "might", "can", "could", "would"), and common
/// scripture adverbs ("then", "now", "up", "out", "there", "here") — these
/// carry meaning in verse text ("thou shalt NOT kill", "ALL have sinned",
/// "WHO is my neighbour") and dropping them made AND/OR queries match the
/// wrong verses.
const STOP_WORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "be", "are", "was",
    "were", "been", "has", "have", "had", "do", "does", "did", "that",
    "this", "these", "those", "he", "she", "we", "they", "you", "i",
    "me", "him", "her", "us", "them", "my", "his", "its", "our", "your",
    "their", "so", "if", "as", "am", "about", "into", "than",
    "just", "also", "very", "like", "even",
];

static STOP_WORD_SET: LazyLock<HashSet<&str>> = LazyLock::new(|| {
    STOP_WORDS.iter().copied().collect()
});

fn is_stop_word(word: &str) -> bool {
    STOP_WORD_SET.contains(word.to_lowercase().as_str())
}

// ── FTS5 query builders ─────────────────────────────────────────────

/// Clean input: strip non-alphanumeric chars (except apostrophes).
fn clean_word(w: &str) -> String {
    w.chars()
        .filter(|c| c.is_alphanumeric() || *c == '\'')
        .collect()
}

/// Exact phrase match — wraps entire input in double quotes.
/// `"Follow peace with all men"` matches only verses containing that exact sequence.
fn build_phrase_query(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '\'')
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    format!("\"{trimmed}\"")
}

/// AND query with stop words removed — all significant words must be present.
/// `"be doers of the word"` → `doers word` (finds James 1:22).
/// Capped at 12 terms to prevent expensive queries on long text.
fn build_and_query(input: &str) -> String {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(clean_word)
        .filter(|w| w.len() >= 2 && !is_stop_word(w))
        .take(12)
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    tokens.join(" ")
}

/// OR query with stop words removed — any significant word matches.
/// `"It's a new creature Old things passed away"` → `"creature" OR "things" OR "passed" OR "away"`.
/// Capped at 10 terms to prevent expensive queries.
fn build_or_query(input: &str) -> String {
    let tokens: Vec<String> = input
        .split_whitespace()
        .map(clean_word)
        .filter(|w| w.len() >= 3 && !is_stop_word(w))
        .take(10)
        .map(|w| format!("\"{w}\""))
        .collect();
    if tokens.is_empty() {
        return String::new();
    }
    tokens.join(" OR ")
}

// ── SQL runner ──────────────────────────────────────────────────────

/// Upper bound on how many rows a single verse can occupy in the FTS index
/// (one per English translation, currently 7, with headroom). Used to size
/// the inner materialization limit in `run_fts_query`.
const TRANSLATION_FANOUT: usize = 10;

/// Execute a BM25-ranked FTS5 query across all English translations.
///
/// Grouped by verse reference so the LIMIT applies to UNIQUE verses: without
/// the grouping, one verse matched in all 7 English translations consumed 7
/// result slots, collapsing recall. Each verse keeps its best (lowest) BM25
/// rank across translations; `SQLite` guarantees the bare columns come from
/// the row that produced the `MIN()` value.
///
/// The CTE must be MATERIALIZED: FTS5's `bm25()` auxiliary function cannot
/// run in an aggregate context, and without materialization `SQLite` flattens
/// the subquery into the outer aggregate ("unable to use function bm25 in
/// the requested context").
///
/// The inner `LIMIT` bounds materialization on broad queries (an OR of
/// common words can match most of the corpus) while staying exact: with at
/// most `TRANSLATION_FANOUT` rows per verse, the best row of each of the
/// top `limit` unique verses always sits within the top
/// `limit × TRANSLATION_FANOUT` ranked rows.
#[expect(
    clippy::cast_possible_wrap,
    reason = "limit is a small page-size value that fits in i64"
)]
fn run_fts_query(
    conn: &Connection,
    fts_query: &str,
    limit: usize,
) -> Result<Vec<Bm25Result>, BibleError> {
    if fts_query.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare(
        "WITH ranked AS MATERIALIZED ( \
             SELECT bm25(verses_fts) as rank, v.book_number, v.book_name, v.chapter, v.verse \
             FROM verses_fts fts \
             JOIN verses v ON v.rowid = fts.rowid \
             JOIN translations t ON v.translation_id = t.id \
             WHERE fts.text MATCH ?1 AND t.language = 'en' \
             ORDER BY rank \
             LIMIT ?3 \
         ) \
         SELECT MIN(rank) as rank, book_number, book_name, chapter, verse \
         FROM ranked \
         GROUP BY book_number, chapter, verse \
         ORDER BY rank \
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(
        rusqlite::params![
            fts_query,
            limit as i64,
            (limit * TRANSLATION_FANOUT) as i64
        ],
        |row: &rusqlite::Row| {
            Ok(Bm25Result {
                rank: row.get(0)?,
                book_number: row.get(1)?,
                book_name: row.get(2)?,
                chapter: row.get(3)?,
                verse: row.get(4)?,
                phrase_match: false,
            })
        },
    )?;
    rows.collect::<Result<Vec<_>, _>>().map_err(BibleError::from)
}

/// Deduplicate results by (`book_number`, chapter, verse), keeping first occurrence.
fn dedup_results(results: Vec<Bm25Result>, limit: usize) -> Vec<Bm25Result> {
    let mut seen = HashSet::new();
    results
        .into_iter()
        .filter(|r| seen.insert((r.book_number, r.chapter, r.verse)))
        .take(limit)
        .collect()
}

fn dedup_count(results: &[Bm25Result]) -> usize {
    let mut seen = HashSet::new();
    results
        .iter()
        .filter(|r| seen.insert((r.book_number, r.chapter, r.verse)))
        .count()
}

// ── BibleDb methods ─────────────────────────────────────────────────

impl BibleDb {
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (i.e., a thread panicked
    /// while holding the database lock).
    pub fn search_verses(
        &self,
        query: &str,
        translation_id: i64,
        limit: usize,
    ) -> Result<Vec<Verse>, BibleError> {
        let conn = self.conn.lock().map_err(|e| BibleError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT v.id, v.translation_id, v.book_number, v.book_name, v.book_abbreviation, v.chapter, v.verse, v.text \
             FROM verses_fts fts \
             JOIN verses v ON v.rowid = fts.rowid \
             WHERE fts.text MATCH ?1 AND v.translation_id = ?2 \
             LIMIT ?3",
        )?;
        #[expect(
            clippy::cast_possible_wrap,
            reason = "limit is a small page-size value that fits in i64"
        )]
        let limit_i64 = limit as i64;
        let rows = stmt.query_map(
            rusqlite::params![query, translation_id, limit_i64],
            |row: &rusqlite::Row| {
                Ok(Verse {
                    id: row.get(0)?,
                    translation_id: row.get(1)?,
                    book_number: row.get(2)?,
                    book_name: row.get(3)?,
                    book_abbreviation: row.get(4)?,
                    chapter: row.get(5)?,
                    verse: row.get(6)?,
                    text: row.get(7)?,
                })
            },
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Search verses using FTS5 with BM25 ranking across all English translations.
    ///
    /// Three-tier strategy with stop-word filtering for speed:
    /// 1. **Phrase** — exact substring match (~5ms)
    /// 2. **AND** — all significant words present, stop words removed (~5-20ms)
    /// 3. **OR** — any significant word matches, capped at 10 terms (~10-30ms)
    ///
    /// Results are deduplicated by verse reference across translations.
    pub fn search_verses_bm25(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<Bm25Result>, BibleError> {
        let conn = self.conn.lock().map_err(|e| BibleError::Internal(e.to_string()))?;
        let fetch_limit = limit * 4;

        // Tier 1: Exact phrase match
        let phrase = build_phrase_query(query);
        log::info!("[FTS5-BM25] Phrase: {phrase:?}");
        let mut all_results = run_fts_query(&conn, &phrase, fetch_limit)?;
        for r in &mut all_results {
            r.phrase_match = true;
        }
        // dedup_results keeps the FIRST occurrence per verse, so a verse
        // found by both tier 1 and a later tier keeps phrase_match = true.

        // Tier 2: AND with stop words filtered (~5-20ms)
        if dedup_count(&all_results) < limit {
            let and_q = build_and_query(query);
            if !and_q.is_empty() {
                log::info!("[FTS5-BM25] AND: {and_q:?}");
                all_results.extend(run_fts_query(&conn, &and_q, fetch_limit)?);
            }
        }

        // Tier 3: OR with stop words filtered, capped at 10 terms (~10-30ms)
        if dedup_count(&all_results) < limit {
            let or_q = build_or_query(query);
            if !or_q.is_empty() {
                log::info!("[FTS5-BM25] OR: {or_q:?}");
                all_results.extend(run_fts_query(&conn, &or_q, fetch_limit)?);
            }
        }

        let results = dedup_results(all_results, limit);
        log::info!("[FTS5-BM25] Found {} unique verses", results.len());
        Ok(results)
    }

    pub fn search_books(&self, query: &str) -> Result<Vec<Book>, BibleError> {
        let conn = self.conn.lock().map_err(|e| BibleError::Internal(e.to_string()))?;
        let pattern = format!("{query}%");
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, name, abbreviation, testament \
             FROM books \
             WHERE name LIKE ?1 OR abbreviation LIKE ?1 \
             ORDER BY book_number",
        )?;
        let rows = stmt.query_map(rusqlite::params![pattern], |row: &rusqlite::Row| {
            Ok(Book {
                id: row.get(0)?,
                translation_id: row.get(1)?,
                book_number: row.get(2)?,
                name: row.get(3)?,
                abbreviation: row.get(4)?,
                testament: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrase_query_wraps_input() {
        assert_eq!(
            build_phrase_query("Follow peace with all men"),
            "\"Follow peace with all men\""
        );
    }

    #[test]
    fn phrase_query_strips_special_chars() {
        assert_eq!(
            build_phrase_query("God's love* NEAR/2"),
            "\"God's love NEAR2\""
        );
    }

    #[test]
    fn phrase_query_empty() {
        assert_eq!(build_phrase_query(""), String::new());
    }

    #[test]
    fn and_query_filters_stop_words() {
        assert_eq!(
            build_and_query("be doers of the word"),
            "doers word"
        );
    }

    #[test]
    fn and_query_filters_all_stop_words() {
        assert_eq!(build_and_query("I am a the"), String::new());
    }

    #[test]
    fn and_query_keeps_significant_words() {
        assert_eq!(
            build_and_query("for God so loved the world"),
            "God loved world"
        );
    }

    #[test]
    fn and_query_caps_at_12_terms() {
        let long_input = "God love peace faith hope joy spirit truth grace mercy light salvation prayer worship glory kingdom";
        let result = build_and_query(long_input);
        let term_count = result.split_whitespace().count();
        assert!(term_count <= 12);
    }

    #[test]
    fn or_query_filters_stop_words() {
        assert_eq!(
            build_or_query("It's a new creature Old things are passed away"),
            "\"It's\" OR \"new\" OR \"creature\" OR \"Old\" OR \"things\" OR \"passed\" OR \"away\""
        );
    }

    #[test]
    fn or_query_caps_at_10_terms() {
        let long_input = "God love peace faith hope joy spirit truth grace mercy light salvation prayer";
        let result = build_or_query(long_input);
        let term_count = result.matches(" OR ").count() + 1;
        assert!(term_count <= 10);
    }

    #[test]
    fn or_query_empty_on_all_stop_words() {
        assert_eq!(build_or_query("I am a the is"), String::new());
    }

    #[test]
    fn and_query_keeps_negations() {
        // "not" must survive filtering: "thou shalt not kill" loses all
        // meaning without it.
        assert_eq!(
            build_and_query("do not be afraid"),
            "not afraid"
        );
    }

    #[test]
    fn and_query_keeps_modals_and_quantifiers() {
        assert_eq!(
            build_and_query("thou shalt not kill"),
            "thou shalt not kill"
        );
        assert_eq!(
            build_and_query("for all have sinned"),
            "all sinned"
        );
    }

    #[test]
    fn and_query_keeps_question_words() {
        assert_eq!(
            build_and_query("who is my neighbour"),
            "who neighbour"
        );
    }

    /// Build an in-memory-style test database with the production schema
    /// subset (verses + FTS index + translations) and two English
    /// translations containing the same verses.
    fn test_db() -> BibleDb {
        let path = std::env::temp_dir().join(format!(
            "rhema-search-test-{}-{:?}.db",
            std::process::id(),
            std::thread::current().id(),
        ));
        let _ = std::fs::remove_file(&path);
        let db = BibleDb::open_writable(&path).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute_batch(
                "CREATE TABLE translations (id INTEGER PRIMARY KEY, language TEXT);
                 CREATE TABLE verses (
                     id INTEGER PRIMARY KEY,
                     translation_id INTEGER,
                     book_number INTEGER,
                     book_name TEXT,
                     book_abbreviation TEXT,
                     chapter INTEGER,
                     verse INTEGER,
                     text TEXT
                 );
                 CREATE VIRTUAL TABLE verses_fts USING fts5(
                     text, content='verses', content_rowid='id', tokenize='unicode61'
                 );
                 INSERT INTO translations VALUES (1, 'en'), (2, 'en');
                 INSERT INTO verses VALUES
                   (1, 1, 43, 'John', 'Jhn', 3, 16, 'For God so loved the world, that he gave his only begotten Son'),
                   (2, 2, 43, 'John', 'Jhn', 3, 16, 'For God so loved the world that he gave his one and only Son'),
                   (3, 1, 43, 'John', 'Jhn', 3, 17, 'For God sent not his Son into the world to condemn the world'),
                   (4, 2, 43, 'John', 'Jhn', 3, 17, 'For God did not send his Son into the world to condemn the world');
                 INSERT INTO verses_fts(rowid, text) SELECT id, text FROM verses;",
            )
            .unwrap();
        }
        db
    }

    #[test]
    fn bm25_search_dedups_across_translations() {
        let db = test_db();
        let results = db.search_verses_bm25("God so loved the world", 10).unwrap();
        // Two translations of John 3:16 collapse into one result; 3:17 may
        // follow from the AND/OR tiers. No verse reference appears twice.
        assert!(!results.is_empty(), "FTS query returned no rows — SQL error?");
        let mut seen = HashSet::new();
        for r in &results {
            assert!(
                seen.insert((r.book_number, r.chapter, r.verse)),
                "duplicate verse {} {}:{} in results",
                r.book_number,
                r.chapter,
                r.verse
            );
        }
        assert_eq!((results[0].book_number, results[0].chapter, results[0].verse), (43, 3, 16));
    }

    #[test]
    fn bm25_search_limit_counts_unique_verses() {
        let db = test_db();
        let results = db.search_verses_bm25("world", 2).unwrap();
        // "world" matches both verses in both translations; the limit must
        // yield 2 UNIQUE verses, not one verse twice.
        assert_eq!(results.len(), 2);
        let keys: HashSet<(i32, i32, i32)> = results
            .iter()
            .map(|r| (r.book_number, r.chapter, r.verse))
            .collect();
        assert_eq!(keys.len(), 2);
    }
}
