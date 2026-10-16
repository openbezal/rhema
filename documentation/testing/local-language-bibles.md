# Hausa and Igbo Bible data

This independent slice extends our reviewed Yoruba/data foundation (#187). It uses official publisher editions, not KJV translations: **BSRK — Biblica® Open Hausa Contemporary Bible™** and **BIUO — Biblica® Open Igbo Contemporary Bible™**. Their native titles and original attribution are retained in the source specifications and complete bundled notices. Stable codes are the abbreviations published by eBible; runtime database IDs remain implementation details.

## Sources and transformation

[Hausa source and terms](https://ebible.org/find/details.php?id=hausa) and [Igbo source and terms](https://ebible.org/find/details.php?id=ibo) identify Biblica, the CC BY-SA 4.0 license and the required copyright/trademark notices. The details pages label their last updates 2025-05-03 and 2023-04-12 respectively; immutable archive identity is the SHA-256 in `data/local-bible-sources.json`. The untouched archive about pages are bundled beside full readable notices, including the publisher's conditions for unmodified redistribution and derivative wording. This is a format conversion of licensed Scripture; canonical English book names are navigation metadata. No Scripture wording or omitted references are supplied or normalized.

The shared VPL parser was extracted from our own tested Yoruba converter, whose output checksum remains unchanged. It preserves Unicode/punctuation and maps official book codes to canonical numbers independently of source order. Source preparation verifies archive, VPL, notice and generated JSON hashes, all 66 books, all 1,189 chapters, and each edition's per-book verse counts before atomically replacing a source. The builder separately refuses an unreviewed BSRK/BIUO JSON file, preserving the working database after failure. Source-specification hashes and newly installed inputs invalidate setup freshness.

| Edition | Books | Chapters | Verses | Matthew 17:21 |
| --- | --- | --- | --- | --- |
| OYCB (existing foundation) | 66 | 1,189 | 31,087 | Source-defined coverage |
| BSRK | 66 | 1,189 | 31,087 | Absent in this source |
| BIUO | 66 | 1,189 | 31,103 | Present in this source |

The supplied [Igbo API lead](https://bible.helloao.org/api/ibo_bib/complete.json) identifies the same official edition and links to eBible. After the explicit USFM/VPL code crosswalk, its 31,103 verse coordinates match the official VPL with no missing/extra coordinates. Its markup and spacing differ: 19,320 of 19,963 plain-content verses match exactly, 19,940 match after whitespace normalization, and 11,140 verses contain structured markup. These are comparison observations, not permission to replace the pinned text. Production ingests only the official VPL.

## Verification

Local gates: **322 frontend/data tests across 28 files**, typecheck, lint and production build; **380 Rust tests in each default/no-default configuration**, strict Clippy, formatting and diff checks. Data tests cover conversion, Unicode, malformed/duplicate rows, omitted coordinates, missing chapters, all checksum failure boundaries, unchanged-source skip, database preservation, packaging/freshness metadata and stable-code selection after runtime IDs change. The notices component test covers all three full notices and scroll reset; the scroll defect was first observed in the real browser and reproduced before fixing it.

[Real corpus results](fixtures/local-language-corpus-results.json) came from freshly verified official archives and an isolated database rebuild using existing legacy input files. The resulting database has 10 translations, valid SQLite integrity, no foreign-key errors and no empty Hausa/Igbo verses. No cross-reference input was provisioned for that run. The checked source/JSON hashes, per-book counts and database hash make the result reproducible; generated corpus/DB files remain ignored.

A separate macOS Apple Silicon ad-hoc debug app bundle was built with a QA identifier. [Bundle results](fixtures/local-language-bundle-results.json) verify byte-for-byte installed Bible/notices/source metadata, the actual installed database's three local-language counts, and absence of the temporary QA browser fixture. The app was **not launched**; this is resource/package inspection, not native UI acceptance.

Real browser interaction exercised the production notices component at **1024×600**, including all three languages, Unicode, complete scrolling, keyboard scrolling, returning to the top after a language switch, closing and restored trigger focus. The dialog measured 672×480 and stayed inside the viewport. The [Hausa](assets/local-language-hausa-minimum.png), [Igbo](assets/local-language-igbo-minimum.png) and [notice end](assets/local-language-igbo-notice-end.png) screenshots are retained. The small [TSX](fixtures/local-language-browser-fixture.tsx.txt)/[HTML](fixtures/local-language-browser-fixture.html.txt) fixtures make no native/database calls; they are excluded from production compilation. The tab/server were closed, the viewport reset, temporary root files removed and normal Vite input restored before the final build.

Windows/Linux installed-bundle checks, packaged native selection/restart and integration with the other remediation branches remain acceptance work. This contributes the remaining requested languages to #106; it does not close that issue or any existing PR.
