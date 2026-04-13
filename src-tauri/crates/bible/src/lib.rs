//! Bible database access for the Rhema application.
//!
//! Provides SQLite-backed storage and retrieval for Bible translations,
//! books, verses, and cross-references. Supports full-text search via
//! FTS5 with BM25 ranking.
//!
//! # Key types
//!
//! - [`BibleDb`] — connection wrapper for the `SQLite` database
//! - [`Verse`], [`Book`], [`Translation`] — data models
//! - [`BibleError`] — error type for all database operations

pub mod models;
pub mod error;
pub mod db;
pub mod lookup;
pub mod search;
pub mod crossref;

pub use models::*;
pub use error::*;
pub use db::*;
pub use search::Bm25Result;
