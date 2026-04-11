use thiserror::Error;

/// Comprehensive Error type for core operations.
#[derive(Debug, Error, Clone)]
pub enum CoreError {
    #[error("Synchronization error (poisoned lock): {0}")]
    Synchronization(String),

    #[error("Internal core error: {0}")]
    Internal(String),

    #[error("Type safety violation: {0}")]
    TypeViolation(String),
}

/// Type-safe Wrapper for Bible Book ID (1-66+).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct BookId(pub u8);

impl BookId {
    pub const fn null() -> Self { Self(0) }
    pub fn is_null(&self) -> bool { self.0 == 0 }
}

/// Type-safe Wrapper for Bible Chapter Number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct ChapterNumber(pub u16);

impl ChapterNumber {
    pub const fn null() -> Self { Self(0) }
    pub fn is_null(&self) -> bool { self.0 == 0 }
}

/// Type-safe Wrapper for Bible Verse Number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct VerseNumber(pub u16);

impl VerseNumber {
    pub const fn null() -> Self { Self(0) }
    pub fn is_null(&self) -> bool { self.0 == 0 }
}

impl std::fmt::Display for BookId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::fmt::Display for ChapterNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::fmt::Display for VerseNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl rusqlite::types::ToSql for BookId {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.0 as i32))
    }
}

impl rusqlite::types::FromSql for BookId {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        i32::column_result(value).map(|n| BookId(n as u8))
    }
}

impl rusqlite::types::ToSql for ChapterNumber {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.0 as i32))
    }
}

impl rusqlite::types::FromSql for ChapterNumber {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        i32::column_result(value).map(|n| ChapterNumber(n as u16))
    }
}

impl rusqlite::types::ToSql for VerseNumber {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::from(self.0 as i32))
    }
}

impl rusqlite::types::FromSql for VerseNumber {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        i32::column_result(value).map(|n| VerseNumber(n as u16))
    }
}

/// Domain events for structured observability.
///
/// Published by core functions to satisfy Rule #8 of the Observability Mandate.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InternalEvent {
    BibleDetection {
        book_id: BookId,
        chapter: ChapterNumber,
        verse: VerseNumber,
        confidence: f64,
        source: String,
    },
    ReadingAdvance {
        book_id: BookId,
        chapter: ChapterNumber,
        verse: VerseNumber,
        reference: String,
    },
    SystemStatus {
        module: String,
        status: String,
        message: String,
    },
}

impl InternalEvent {
    /// Emit the event to the log with structured formatting.
    pub fn emit(&self) {
        if let Ok(json) = serde_json::to_string(self) {
            log::info!("[EVENT] {}", json);
        }
    }
}

/// Professional extension for `std::sync::Mutex` to provide poison-safe locking.
pub trait MutexExt<T> {
    /// Lock the mutex and return a `CoreError::Synchronization` instead of panicking on poison.
    fn lock_safe(&self) -> Result<std::sync::MutexGuard<'_, T>, CoreError>;
}

impl<T> MutexExt<T> for std::sync::Mutex<T> {
    fn lock_safe(&self) -> Result<std::sync::MutexGuard<'_, T>, CoreError> {
        self.lock()
            .map_err(|e| CoreError::Synchronization(e.to_string()))
    }
}
