#!/usr/bin/env python3
"""
Convert every EasyWorship Bible (.ewb) SQLite database under
data/bg_temp/ewbs/ into Scrollmapper-style JSON files in data/sources/,
ready for data/build-bible-db.ts.

Usage:
    python3 data/extract-all-ewb.py [ewbs_dir] [sources_dir]

Defaults: data/bg_temp/ewbs -> data/sources (relative to repo root).

See data/lib/ewb_extract.py for the reverse-engineered binary format notes.
"""

import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "data" / "lib"))

from ewb_extract import extract_ewb, total_verses  # noqa: E402


def sanity_check(data: dict, src: Path) -> None:
    """Generic structural checks - raises AssertionError on failure."""
    assert data["books"], f"{src}: no books extracted"
    for book in data["books"]:
        assert book["chapters"], f"{src}: {book['name']!r} has no chapters"
        for chapter in book["chapters"]:
            assert chapter[
                "verses"
            ], f"{src}: {book['name']!r} ch{chapter['chapter']} has no verses"

    total = total_verses(data)
    assert total > 0, f"{src}: total verse count is 0"

    # First verse of the first book should have real text.
    first_verse = data["books"][0]["chapters"][0]["verses"][0]
    assert first_verse["text"], f"{src}: first verse text is empty"


def main() -> None:
    ewbs_dir = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else REPO_ROOT / "data" / "bg_temp" / "ewbs"
    )
    sources_dir = (
        Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "data" / "sources"
    )
    sources_dir.mkdir(parents=True, exist_ok=True)

    ewb_files = sorted(ewbs_dir.glob("*.ewb"))
    if not ewb_files:
        print(f"No .ewb files found in {ewbs_dir}")
        return

    results = []
    for path in ewb_files:
        out_path = sources_dir / f"{path.stem.upper()}.json"
        if out_path.exists():
            print(f"⏭  {path.name}: {out_path.name} already exists, skipping")
            continue

        if path.stat().st_size == 0:
            print(f"⏭  {path.name}: empty file, skipping")
            continue

        try:
            data = extract_ewb(path)
        except sqlite3.DatabaseError as e:
            print(f"⏭  {path.name}: not a SQLite EWB database ({e}), skipping")
            continue

        try:
            sanity_check(data, path)
        except AssertionError as e:
            print(f"❌ {path.name}: {e}")
            continue

        abbrev = data["translation"]["abbreviation"]
        # out_path = sources_dir / f"{abbrev}.json"        # We've already determined the output path above.
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        total = total_verses(data)
        results.append((path.name, abbrev, len(data["books"]), total))
        print(
            f"✓  {path.name:18s} -> {out_path.relative_to(REPO_ROOT)} "
            f"({data['translation']['name']}, {len(data['books'])} books, {total} verses)"
        )

    print(
        f"\n{len(results)} translation(s) written to {sources_dir.relative_to(REPO_ROOT)}/"
    )


if __name__ == "__main__":
    main()
