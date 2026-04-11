#!/usr/bin/env python3
"""
Download Bible translations from BibleGateway and convert to scrollmapper JSON format.
Uses the `meaningless` library.

Usage:
  source .venv/bin/activate
  python3 data/download-biblegateway.py

Output: data/sources/<ABBREV>.json for each translation
"""

import json
import os
import socket
import sys
import time
import traceback
from pathlib import Path

from meaningless import JSONDownloader
import meaningless.utilities.common as common

# Override to handle chapters with many verses
def custom_get_capped_integer(number, min_value=1, max_value=200):
    return min(max(int(number), int(min_value)), int(max_value))
common.get_capped_integer = custom_get_capped_integer

# Monkey-patch get_page to add a 15s socket timeout so requests never hang
_original_get_page = common.get_page
def _get_page_with_timeout(url, retry_count=3, retry_delay=2):
    old_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(15)
    try:
        return _original_get_page(url, retry_count, retry_delay)
    finally:
        socket.setdefaulttimeout(old_timeout)
common.get_page = _get_page_with_timeout

# Delay between book downloads to avoid BibleGateway rate-limiting
BOOK_DELAY = 2  # seconds
MAX_RETRIES = 3  # retries per book

TRANSLATIONS = ["NIV", "ESV", "NASB", "NKJV", "NLT", "AMP"]

BOOKS = [
    "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
    "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
    "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles",
    "Ezra", "Nehemiah", "Esther", "Job", "Psalm", "Proverbs",
    "Ecclesiastes", "Song Of Solomon", "Isaiah", "Jeremiah",
    "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
    "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah",
    "Haggai", "Zechariah", "Malachi",
    "Matthew", "Mark", "Luke", "John", "Acts", "Romans",
    "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
    "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
    "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
    "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John",
    "Jude", "Revelation"
]

# Map BibleGateway book names to scrollmapper format
BOOK_NAME_MAP = {
    "Psalm": "Psalms",
    "Song Of Solomon": "Song of Solomon",
}

ROOT = Path(__file__).resolve().parent
SOURCES_DIR = ROOT / "sources"
TEMP_DIR = ROOT / "bg_temp"


def convert_to_scrollmapper(combined, abbrev):
    """Convert {Book: {chapter: {verse: text}}} to scrollmapper format."""
    scrollmapper = {
        "translation": f"{abbrev}",
        "books": []
    }

    for book_name in BOOKS:
        bg_name = book_name
        display_name = BOOK_NAME_MAP.get(book_name, book_name)

        if bg_name not in combined:
            if book_name in BOOK_NAME_MAP:
                bg_name = BOOK_NAME_MAP[book_name]
            if bg_name not in combined:
                print(f"  ⚠ Book '{book_name}' not found")
                continue

        chapters_data = combined[bg_name]
        chapters = []

        for ch_num_str in sorted(chapters_data.keys(), key=int):
            verses_data = chapters_data[ch_num_str]
            verses = []
            for v_num_str in sorted(verses_data.keys(), key=int):
                text = verses_data[v_num_str].strip()
                text = " ".join(text.split())
                verses.append({"verse": int(v_num_str), "text": text})
            chapters.append({"chapter": int(ch_num_str), "verses": verses})

        scrollmapper["books"].append({
            "name": display_name,
            "chapters": chapters
        })

    return scrollmapper


def download_book(book_name, book_file, abbrev):
    """Download a single book, creating a fresh downloader each time."""
    downloader = JSONDownloader(
        translation=abbrev,
        show_passage_numbers=False,
        strip_excess_whitespace=True,
        enable_multiprocessing=False,
    )
    downloader.download_book(book_name, str(book_file))


def load_cached_book(book_file):
    """Load a previously downloaded book from bg_temp if valid."""
    if not book_file.exists() or book_file.stat().st_size < 10:
        return None
    try:
        with open(book_file, encoding='utf-8') as f:
            data = json.load(f)
        if "Info" in data:
            del data["Info"]
        if len(data) > 0:
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return None


def download_translation(abbrev):
    """Download all books for a translation and convert to scrollmapper JSON."""
    print(f"\n📖 Downloading {abbrev}...")

    output_file = SOURCES_DIR / f"{abbrev}.json"
    if output_file.exists():
        print(f"  ⏭ {abbrev}.json already exists, skipping")
        return True

    combined = {}
    temp_path = TEMP_DIR / abbrev
    temp_path.mkdir(parents=True, exist_ok=True)

    total = len(BOOKS)
    cached_count = 0
    failed_books = []

    for i, book in enumerate(BOOKS):
        book_file = temp_path / f"{book}.json"

        # Resume: use cached file from bg_temp if available
        cached = load_cached_book(book_file)
        if cached is not None:
            print(f"  [{i+1:2d}/{total}] {book:<20s} (cached)")
            combined.update(cached)
            cached_count += 1
            continue

        # Download with retries — fresh downloader per book
        success = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                print(f"  [{i+1:2d}/{total}] {book:<20s}", end="", flush=True)
                if attempt > 1:
                    print(f" (retry {attempt}/{MAX_RETRIES})", end="", flush=True)

                download_book(book, book_file, abbrev)

                with open(book_file, encoding='utf-8') as f:
                    data = json.load(f)
                    if "Info" in data:
                        del data["Info"]
                    combined.update(data)

                print()
                success = True
                break

            except Exception as e:
                error_msg = str(e) or type(e).__name__
                print(f" ⚠ {error_msg}")
                if attempt < MAX_RETRIES:
                    backoff = BOOK_DELAY * (2 ** attempt)
                    print(f"         Waiting {backoff}s before retry...")
                    time.sleep(backoff)

        if not success:
            failed_books.append(book)

        time.sleep(BOOK_DELAY)

    print(f"\n  ✓ Downloaded {len(combined)} books ({cached_count} from cache)")
    if failed_books:
        print(f"  ⚠ Failed books: {', '.join(failed_books)}")

    # Convert to scrollmapper format and write
    scrollmapper = convert_to_scrollmapper(combined, abbrev)

    with open(output_file, "w", encoding='utf-8') as f:
        json.dump(scrollmapper, f, indent=2)

    size_mb = output_file.stat().st_size / 1024 / 1024
    verse_count = sum(
        len(ch["verses"])
        for book in scrollmapper["books"]
        for ch in book["chapters"]
    )
    print(f"  ✓ Saved {output_file.name} ({size_mb:.1f} MB, {verse_count} verses)")
    return True


def main():
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)

    print(f"=== Downloading {len(TRANSLATIONS)} translations from BibleGateway ===")
    print(f"Translations: {', '.join(TRANSLATIONS)}")

    for abbrev in TRANSLATIONS:
        try:
            download_translation(abbrev)
        except Exception as e:
            print(f"\n  ❌ {abbrev} failed: {e}")
            traceback.print_exc()

    print(f"\n✅ Done! Check {SOURCES_DIR} for output files.\n")


if __name__ == "__main__":
    main()
