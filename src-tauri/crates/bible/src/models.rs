use serde::{Deserialize, Serialize};
use rhema_core::{BookId, ChapterNumber, VerseNumber};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Translation {
    pub id: i64,
    pub abbreviation: String,
    pub title: String,
    pub language: String,
    pub is_copyrighted: bool,
    pub is_downloaded: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Book {
    pub id: i64,
    pub translation_id: i64,
    pub book_number: BookId,
    pub name: String,
    pub abbreviation: String,
    pub testament: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Verse {
    pub id: i64,
    pub translation_id: i64,
    pub book_number: BookId,
    pub book_name: String,
    pub book_abbreviation: String,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrossReference {
    pub from_ref: String,
    pub to_ref: String,
    pub votes: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuotationVerse {
    pub id: i64,
    pub book_number: BookId,
    pub book_name: String,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub text: String,
}

/// A compact verse row used for client-side search indexing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchVerse {
    pub book_number: BookId,
    pub book_name: String,
    pub chapter: ChapterNumber,
    pub verse: VerseNumber,
    pub text: String,
}
