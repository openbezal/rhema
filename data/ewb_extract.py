#!/usr/bin/env python3
"""
Shared extraction logic for EasyWorship Bible (.ewb) SQLite databases.

See data/extract-msg-bible.py for the full reverse-engineering notes on the
binary format. Summary:

- header.id is the translation id, used to decode verse_info records.
- books.verse_info is 8 bytes per verse record:
    bytes 0-3 (little-endian uint32 val1):
        char_offset = (val1 >> 8) // 4   - codepoint offset into the
        decoded text of this book's stream (the low 2 bits of val1>>8 are
        unrelated flags; `val1 & 0xFF` "length" is unreliable, unused).
    bytes 4-7 (little-endian uint32 val2):
        val2 = translation_id*2*2^24 + book_rowid*2^18 + chapter*2^10 + verse*4
        Decoded by subtracting translation_id's contribution first, then
        dividing/modding by 2^18, 2^10, 4 - this handles the carry that
        occurs for book_rowid >= 64 (3 John, Jude, Revelation) and for
        chapters >= 64 (e.g. Psalm 119+), since it operates on the full
        32-bit integer rather than per-byte fields.
- streams.stream (rowid == books.rowid) is zlib-compressed; after
  decompression, skip the first 2 bytes and decode the rest as UTF-8 to get
  the book's full text (verses concatenated with no delimiters).
- A book's verse_info can contain records for *other* book_rowids
  (cross-references into other books' streams) - only records whose
  decoded book_rowid matches the current book's rowid are used.
"""

import struct
import sqlite3
import zlib


def decode_book_chapter_verse(val2: int, translation_id: int) -> tuple[int, int, int]:
    """Decode bytes 4-7 of a verse_info record into (book_rowid, chapter, verse)."""
    remainder = val2 - translation_id * 2 * 16777216  # subtract translation_id*2 * 2^24
    book = remainder // 262144  # 2^18
    remainder %= 262144
    chapter = remainder // 1024  # 2^10
    remainder %= 1024
    verse = remainder // 4
    return book, chapter, verse


def get_stream_text(cur: sqlite3.Cursor, rowid: int) -> str:
    cur.execute("SELECT stream FROM streams WHERE rowid = ?", (rowid,))
    (raw,) = cur.fetchone()
    return zlib.decompress(raw)[2:].decode("utf-8")


def extract_book(cur: sqlite3.Cursor, rowid: int, translation_id: int) -> dict:
    """Extract one book (by books.rowid) into {name, chapters: [...]}."""
    cur.execute("SELECT name, verse_info FROM books WHERE rowid = ?", (rowid,))
    name, verse_info = cur.fetchone()

    text = get_stream_text(cur, rowid)

    records = []
    for i in range(len(verse_info) // 8):
        val1 = struct.unpack_from("<I", verse_info, i * 8)[0]
        val2 = struct.unpack_from("<I", verse_info, i * 8 + 4)[0]
        char_offset = (val1 >> 8) // 4
        book, chapter, verse = decode_book_chapter_verse(val2, translation_id)
        if book == rowid:
            records.append((char_offset, chapter, verse))

    records.sort(key=lambda r: r[0])

    chapters: dict[int, list[tuple[int, str]]] = {}
    for idx, (offset, chapter, verse) in enumerate(records):
        end = records[idx + 1][0] if idx + 1 < len(records) else len(text)
        verse_text = text[offset:end].strip()
        chapters.setdefault(chapter, []).append((verse, verse_text))

    chapter_list = []
    for chapter_num in sorted(chapters):
        verses = sorted(chapters[chapter_num], key=lambda v: v[0])
        chapter_list.append(
            {
                "chapter": chapter_num,
                "verses": [{"verse": v, "text": t} for v, t in verses],
            }
        )

    return {"name": name, "chapters": chapter_list}


def extract_ewb(db_path) -> dict:
    """Extract an entire .ewb database into Scrollmapper JSON format."""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT id, name, abbrev_name FROM header")
    translation_id, translation_name, translation_abbrev = cur.fetchone()

    cur.execute("SELECT rowid FROM books ORDER BY rowid")
    book_rowids = [r[0] for r in cur.fetchall()]

    books = [extract_book(cur, rowid, translation_id) for rowid in book_rowids]
    conn.close()

    return {
        "translation": {"name": translation_name, "abbreviation": translation_abbrev},
        "books": books,
    }


def total_verses(data: dict) -> int:
    return sum(len(c["verses"]) for b in data["books"] for c in b["chapters"])
