use crate::db::BibleDb;
use crate::error::BibleError;
use crate::models::{Book, SearchVerse, Translation, Verse};

impl BibleDb {
    /// Look up a verse by its database primary key (verses.id).
    ///
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (i.e., a thread panicked
    /// while holding the database lock). This applies to all `BibleDb` methods.
    pub fn get_verse_by_id(&self, id: i64) -> Result<Option<Verse>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, book_name, book_abbreviation, chapter, verse, text \
             FROM verses WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], |row: &rusqlite::Row| {
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
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn get_verse(
        &self,
        translation_id: i64,
        book_number: i32,
        chapter: i32,
        verse: i32,
    ) -> Result<Option<Verse>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, book_name, book_abbreviation, chapter, verse, text \
             FROM verses \
             WHERE translation_id = ?1 AND book_number = ?2 AND chapter = ?3 AND verse = ?4",
        )?;
        let mut rows = stmt.query_map(
            rusqlite::params![translation_id, book_number, chapter, verse],
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
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn get_chapter(
        &self,
        translation_id: i64,
        book_number: i32,
        chapter: i32,
    ) -> Result<Vec<Verse>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, book_name, book_abbreviation, chapter, verse, text \
             FROM verses \
             WHERE translation_id = ?1 AND book_number = ?2 AND chapter = ?3 \
             ORDER BY verse",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![translation_id, book_number, chapter],
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

    pub fn get_verse_range(
        &self,
        translation_id: i64,
        book_number: i32,
        chapter: i32,
        verse_start: i32,
        verse_end: i32,
    ) -> Result<Vec<Verse>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, book_name, book_abbreviation, chapter, verse, text \
             FROM verses \
             WHERE translation_id = ?1 AND book_number = ?2 AND chapter = ?3 \
               AND verse >= ?4 AND verse <= ?5 \
             ORDER BY verse",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![translation_id, book_number, chapter, verse_start, verse_end],
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

    /// Load all verses for one translation for client-side context search indexing.
    pub fn load_translation_verses_for_search(
        &self,
        translation_id: i64,
    ) -> Result<Vec<SearchVerse>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT book_number, book_name, chapter, verse, text \
             FROM verses \
             WHERE translation_id = ?1 \
             ORDER BY book_number, chapter, verse",
        )?;
        let rows = stmt.query_map([translation_id], |row: &rusqlite::Row| {
            Ok(SearchVerse {
                book_number: row.get(0)?,
                book_name: row.get(1)?,
                chapter: row.get(2)?,
                verse: row.get(3)?,
                text: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_translations(&self) -> Result<Vec<Translation>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, abbreviation, title, language, is_copyrighted, is_downloaded \
             FROM translations",
        )?;
        let rows = stmt.query_map([], |row: &rusqlite::Row| {
            Ok(Translation {
                id: row.get(0)?,
                abbreviation: row.get(1)?,
                title: row.get(2)?,
                language: row.get(3)?,
                is_copyrighted: row.get(4)?,
                is_downloaded: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_books(&self, translation_id: i64) -> Result<Vec<Book>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, translation_id, book_number, name, abbreviation, testament \
             FROM books \
             WHERE translation_id = ?1 \
             ORDER BY book_number",
        )?;
        let rows = stmt.query_map(rusqlite::params![translation_id], |row: &rusqlite::Row| {
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
