# Detection context replay

This change addresses a reproduced class of #175 failures: an incomplete book/person name or fuzzy narration could replace established context before a real citation was supplied. A later verse-only command then acquired that book at direct-reference confidence.

The [reported log](https://github.com/openbezal/rhema/issues/175) contains an Obadiah-only partial at 18:26:39.999 UTC, a later verse-six/person-name partial at 18:27:30.794, and Obadiah 1:6 emitted at 18:27:31.648. The report identifies the intended passage as 1 Kings 18. A minimized replay seeds that intended passage, preserves the long gap and partial/final order, and reproduced the wrong Obadiah reference before the fix.

A separate synthetic narration containing “times” reproduced fuzzy Titus context followed by Titus 1:3 on a later verse-three command. It demonstrates the same failure class; the exact words responsible for the original Titus event have not been recovered from the clipped log. The full sermon log is kept outside the repository.

The context policy is now:

- A bare book name remains an incomplete candidate without replacing established book/chapter context.
- An ambiguous candidate needs chapter/address confirmation before it can own a continuation. A verse-only continuation uses established valid context. Expired context remains expired and does not make a later bare name authoritative.
- Citation parsing starts with an address or a short citation introduction after the book, preserving supported spoken forms, corrections and “John’s gospel” forms. A person name cannot capture a verse command across arbitrary narrative text.
- Bare number-pair correction fallback accepts numeric/citation/correction syntax, rather than ordinary prose containing two numbers. Existing standalone and inline Revelation correction regressions remain covered.
- A repeated partial ending in “James chapter” cannot supply an unspoken chapter one after James 5:17. A rejected chapter clears older chapter context while retaining the book for a complete correction.
- Common “in chapter” navigation remains explicit. An unsupported book introduction cannot reassign its following address to the previous book; only a verse command preceding that named book can use previous context in the same fragment.
- “I meant” works across partial/final splits and in cumulative colon citations. Rejected bookless chapters also revoke chapter authority, and a newly named invalid address reaches its own validation before any older pending continuation.
- An explicit new citation still changes books. No confidence threshold or fuzzy edit-distance threshold was changed.

Direct context and ReadingMode accept a shared monotonic clock for replay; production defaults still use Instant. Tests exercise direct detections and actual ReadingMode transitions together. The reading accumulator retains at most 8 KiB of recent UTF-8 text; oversized fragments are sliced before append, and older fragments are discarded. Verse commands can resume a paused reading session with retained chapter data.

## Evidence

Twenty replay tests cover the timed Obadiah and fuzzy Titus reproductions, same-book chapter preservation, expiry, paused recovery, narrative-name binding, explicit citations/misspellings/spoken partials, ordinary numbers/times, oversized multibyte input and bounded history/text. Combined runs exercise 10, 30, 60 and 120 simulated minutes. A separate two-hour simulated run keeps matching text active and checks the buffer bound on every iteration; these are clock-driven tests, not a two-hour microphone recording.

The pre-fix accumulator exceeded the new 8 KiB bound after 106 simulated seconds. The new bound passes through two simulated hours. Two existing parser correction fixtures used BookMatch.end=0 for “Revelation”; they now use its real matcher end=10, preserving their citation/correction assertions.

## Remaining acceptance

This is a focused context and replay change, not completion of #175. The full original sermon has not been transcribed/replayed end to end. Native STT stop/restart ordering, obsolete worker events and reading-policy handoff require a separate lifecycle pass; microphone/provider and recorded-sermon acceptance remain pending. These tests do not establish receiver latency, complete ASR accuracy or whole-app memory stability.
