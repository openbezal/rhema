# Stable Suggestions history

Related issue: #145. Based on the app-owned detection session (#192); native lifecycle changes in #194 remain separate to integrate.

Quotation matches now have a separate Suggestions panel. Bounded ingestion history is independent from the visible snapshot. Arrivals wait behind **Apply updates**; they cannot move the card being inspected. Hover, keyboard focus, held pointer and scrolling retain inspected cards through expiry. Direct spoken references keep their separate detection view.

Candidate identity includes source, stable translation code and canonical verse coordinates. Settings → Detections defaults to 25 candidates/60 seconds, bounded to 1–100 candidates/1–300 seconds. Dismissal suppresses a candidate for 10 seconds with at most 100 tombstones. Legacy settings get validated defaults. A retained snapshot may temporarily exceed a reduced capacity but never the hard limit of 100.

FTS matches say **Keyword search**, without fabricated percentages. Native packets carry the resolved row's translation and score kind; unresolved packets remain unknown. Queue fetches and validates current source-translation text. Present resolves the primary translation through the presentation controller. The existing one-canonical-reference-per-queue policy remains: duplicates highlight the saved item without overwriting its translation or text.

## Automated checks

404 frontend tests across 34 files, typecheck, lint and production build pass. New tests cover history/expiry/dedupe/capacity, dismissal, settings migration, actual ingestion, hover/focus/held pointer/scroll, pending updates, verified actions, hidden settings changes and delayed-packet attribution. Regression tests were observed failing before implementation.

382 Rust workspace tests pass with default features and with `--no-default-features`; strict Clippy and formatting pass. Two real SQLite tests verify that a resolved KJV row remains attributed to KJV while ESV is selected and unresolved references receive no invented metadata. First-party native artifacts were cleared before checks to avoid cross-worktree cache reuse.

## Browser interaction evidence

A disposable localhost fixture rendered the production Dashboard, panels, stores and theme. Only native IPC was mocked, with synthetic verse text and no microphone, receiver or normal app profile. The temporary harness and Vite edits were removed; server stopped, viewport reset and tab closed.

The operator started with five visible KJV candidates, then ingested five candidates per second while 15 unique updates accumulated. Those five cards stayed visible during scrolling and Queue on John 3:18; Queue showed John 3:18 KJV. Explicit Apply adopted the new ranking. The JSON contains 39 real pointer, focus, keyboard, scroll and click events, including Apply. It is an interaction trace plus screenshots, not video or a recorded sermon.

- [Pending arrivals and correct queue target](../reviews/assets/suggestions-pending-desktop.png)
- [Explicit Apply result](../reviews/assets/suggestions-applied-desktop.png)
- [Minimum 1024×600 window](../reviews/assets/suggestions-minimum.png)
- [Settings controls](../reviews/assets/suggestions-settings.png)
- [Interaction trace](../reviews/assets/suggestions-interaction.json)

At 1280×800, Search, Direct detections and Suggestions sit alongside each other. At the configured 1024×600 minimum, four upper views remain visible; Search takes the first lower row and Direct/Suggestions share the next scrollable row. Settings controls were changed to 3 candidates/1 second, then restored to 25/60; actual bounds/expiry are covered by tests.

## Remaining acceptance

Packaged native operator typing/IME, real audio/provider ingestion, physical NDI/OMT receivers, Windows/vMix cadence, recorded-sermon accuracy and cross-branch integration remain. The direct-reference timeline is a current feed, not a frozen snapshot. These results do not automatically close those acceptance gates or issue #145.

One fresh whole-branch review identified three Important issues and no Critical/Minor findings. All three regressions failed before the single fix pass and pass afterward: removing a focused Dismiss control releases expiry protection; refreshed canonical liveness is tracked independently of visible text/order, including after capacity eviction; and early-reference collision retains the already queued source/text while removing the redundant placeholder and preserving selection/highlight. Full frontend gates were repeated on the fixed head. No second review was run.
