use crate::db::BibleDb;
use crate::error::BibleError;
use crate::models::CrossReference;

impl BibleDb {
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (i.e., a thread panicked
    /// while holding the database lock).
    pub fn get_cross_references(
        &self,
        book_number: i32,
        chapter: i32,
        verse: i32,
    ) -> Result<Vec<CrossReference>, BibleError> {
        let conn = self.conn.lock().unwrap();
        let from_ref = format!("{book_number}:{chapter}:{verse}");
        let mut stmt = conn.prepare(
            "SELECT from_ref, to_ref, votes \
             FROM cross_references \
             WHERE from_ref = ?1 \
             ORDER BY votes DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![from_ref], |row: &rusqlite::Row| {
            Ok(CrossReference {
                from_ref: row.get(0)?,
                to_ref: row.get(1)?,
                votes: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
}
