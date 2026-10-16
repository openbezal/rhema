# Repository Remediation Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Use `superpowers:subagent-driven-development` only if that execution method is selected. Steps use checkboxes for tracking. The owner approved execution with fresh implementations in our own focused PRs. Existing PR code must not be copied, cherry-picked, or amended.

**Goal:** Resolve all ten open issues and address the requirements covered by all eight existing PRs with independently implemented replacements while protecting live output, operator intent, and saved data.

**Architecture:** Incrementally extract app-owned session/navigation/presentation controllers from panels, use shared operator commands, and separate rendering from paced frame delivery. Keep the existing React/Zustand/Tauri stack and Rust workspace. Introduce a stable Suggestions panel and Session archive drawer where responsibilities require them.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Bun/Vitest, Tauri 2, Rust, SQLite/FTS5, Canvas 2D, NDI; native desktop integration tests through a verified Tauri WebDriver setup.

**Spec:** [Repository review and proposed design](../reviews/2026-10-15-open-issues-and-prs.md).

## Approved execution strategy

Implement from current main and our own reviewed foundation branches. Existing PRs are review evidence and requirements only. Keep them open while replacements are developed; closing or merging any PR is a separate integration decision. Do not close an issue until its entire scope and acceptance criteria are satisfied.

The quality foundation is [our draft PR #184](https://github.com/openbezal/rhema/pull/184), with all five validation jobs green. [Our remote-controls PR #185](https://github.com/openbezal/rhema/pull/185) covers #176 with green cross-platform CI; [our stable-translation PR #186](https://github.com/openbezal/rhema/pull/186) adds the migration boundary with green cross-platform CI. [Our Bible-data PR #187](https://github.com/openbezal/rhema/pull/187) adds verified Yoruba data and safe rebuilds, with macOS packaged smoke and all five cross-platform CI jobs passed. [Our numbered-search PR #188](https://github.com/openbezal/rhema/pull/188) covers the independent #181 search requirements with macOS packaged smoke and all five CI jobs passed. [Our output-safety PR #189](https://github.com/openbezal/rhema/pull/189) adds shared availability checks, confirmed transport changes and race guards, with macOS packaged/real-NDI lifecycle smoke and all five CI jobs passed. All remain drafts pending the acceptance work described in each PR. The independent #176 remote-control slice can proceed before translation identity because it does not depend on that migration. [Our presentation-controller PR #191](https://github.com/openbezal/rhema/pull/191) adds verified primary lookups, a common intent gate and explicit clear modes, with all five CI jobs passed. [Our app-owned session PR #192](https://github.com/openbezal/rhema/pull/192) separates Follow from Auto and panel visibility, with 361 frontend tests, all five CI jobs passed and macOS partial smoke; final native typing acceptance remains pending. Task 3 reset orchestration remains tied to the session archive/new-session work. [Our detection-context PR #193](https://github.com/openbezal/rhema/pull/193) adds 20 ordered replay tests, bounded reading text and conservative context ownership, with 389 Rust tests passing in both configurations and all five CI jobs passed. [Our native lifecycle PR #194](https://github.com/openbezal/rhema/pull/194) adds run cancellation, reset boundaries and consumed-once reading handoff, with 404 Rust tests passing in both configurations and all five CI jobs passed; physical provider/recorded-sermon acceptance remains pending. [Our Suggestions PR #195](https://github.com/openbezal/rhema/pull/195) adds stable bounded candidate history, truthful provenance and verified actions, with 404 frontend tests, 382 Rust tests in both configurations, one independent review with all three findings reproduced/fixed, and browser interaction evidence. All five CI jobs passed on its reviewed head. [Our frame-transport PR #196](https://github.com/openbezal/rhema/pull/196) adds bounded binary/native delivery, reload recovery and per-output teardown isolation, with 394 frontend tests, 394 Rust tests in both configurations, and one review/fix pass. Optimized macOS SDK probes received all 400 patterned changes with zero coalescing, p95 42–50 ms and p99 46–60 ms; debug two-output 1080p60 received 97/100 each with three coalesces each, retained as invalid/incomplete evidence. All five cross-platform CI jobs passed. These exclude the renderer/IPC/full app and Windows/vMix; the physical receiver target remains outstanding. Idle fade stays deferred. [Our dual-language PR #197](https://github.com/openbezal/rhema/pull/197) adds independent primary/secondary rendering, styles, stable optional selection and an offline designer sample, with 461 frontend tests, 394 Rust tests in both configurations and all five CI jobs green. [Our keyboard PR #198](https://github.com/openbezal/rhema/pull/198) adds a guarded registry, shared command palette, ordered navigation and focused-list workflows on #195. All three Important findings from one final branch review were reproduced and fixed in one pass; 507 frontend tests, 382 Rust tests in both configurations and all five CI jobs passed. Real browser evidence remains separate from pending native/physical and integrated-stack acceptance.

[Our Hausa/Igbo PR #199](https://github.com/openbezal/rhema/pull/199) extends #187 with pinned official BSRK/BIUO editions (66 books and 1,189 chapters each; 31,087/31,103 verses), safe corpus/freshness checks and full notices. All five cross-platform CI jobs passed; the single review found no blocking defects and independently compared every new verse. macOS bundle resources and browser notices were verified, while native selection/restart, Windows/Linux installed packages and integration remain acceptance work. To make archive/preferences target the actual combined state, Task 11 integration began early: [our integration draft #200](https://github.com/openbezal/rhema/pull/200), head `2765816`, combines our reviewed keyboard, native lifecycle, bilingual/frame, search and language branches with 723 frontend/data tests and 431 Rust tests in both configurations passing. One final review found an Important Suggestions completion defect; it was reproduced and fixed in one pass. All five cross-platform CI jobs passed (run 38831465598). Mocked integrated browser checks cover the 1024×600 operator workflow and delayed secondary lookup/Clear. Outstanding typed Search reclaiming preview on a language change is tracked in Task 9B. Native packages, providers, recorded sermons and physical receivers remain acceptance work. No GitHub merge or closure occurred.

## Global constraints

- Hold the last manually presented verse by default. Auto fade, follow detections, auto live and auto queue are separate operator choices.
- Support packaged macOS Apple Silicon, Windows x64 and Linux x64. Do not infer native correctness from browser mocks.
- Preserve existing HTTP/OSC command compatibility; introduce additions through the shared command boundary.
- Preserve canonical book numbers and speech aliases when changing display names.
- Translation identity uses stable codes independent of database insertion order.
- Default portable exports exclude credentials and machine-specific device/monitor IDs.
- Missing optional secondary text must not veto valid primary text. Missing primary text must not replace valid live content with fabricated Scripture.
- Only an explicit Present action or enabled auto-live policy commits a candidate to live output. Queue/Add actions do not present.
- Each task lands as an independently reviewed, tested change. Re-run checks on the actual rebased/integration head; this audit's test results do not transfer to a changed branch.

## Review focus

1. Late async responses after a newer Present, translation change, clear, session reset, or output stop must not restore stale content — Tasks 3, 6 and 7.
2. A hidden renderer, failed sender, or disabled output must not be mistaken for audience-visible output — Tasks 2 and 6.
3. Narration containing book/person names and corrected partial transcripts must not contaminate reading context — Task 4.
4. Database rebuilds and partial corpora must not silently change the selected language or produce invented verses — Tasks 1, 7 and 10.
5. Pointer/keyboard interaction, dialogs, editable targets and IME composition must preserve operator focus and intent — Tasks 5, 8 and 9.

## Sequence and PR handling

| Stage | Deliverable | Issues/PRs | Depends on |
| --- | --- | --- | --- |
| A | Trustworthy checks and stable translation identities | #174 typecheck portion; #182 foundation | None |
| B | Small search and output-safety fixes | #181, #180 | Quality gates |
| C | Shared session/operator/presentation boundaries; detection replay; stable suggestions | #176, #139, #175, #145 | Quality gates |
| D | Measured broadcast transport and corrected bilingual output | #177, #183; #179 only after redesign | C; translation identity for bilingual persistence |
| E | Keyboard, portable sessions, display preferences and language completeness | #49, #140, #138, #106 | Shared commands/session boundaries |
| F | Optional improvements after core acceptance | #174 notice, #173 export decision, #52 replacement, #178 probe | Relevant foundation, rather than every unrelated task |

Implementation order: our quality foundation → independent remote controls and small search/output safety fixes → stable translation identity and local-language support → shared session/presentation controls and workflow fixes → measured frame transport → bilingual output → remaining operator features. Build each slice independently; existing PR numbers identify reviewed requirements, not source branches to reuse. Update notices can proceed after quality gates. Treat the unsupported quantizer flag separately from exporter behavior. Defer fade and prediction features until their product contracts and dependencies are ready. OMT remains a measured probe after the frame boundary exists.

## Task 0: Make quality gates truthful and usable

**Modify:** `package.json`, `eslint.config.js`, `web/eslint.config.mjs`, first-party files reported by lint/Clippy/fmt, `.github/CONTRIBUTING.md`.

**Create:** `.github/workflows/validate.yml`, `scripts/verify-typecheck.ts`, `scripts/verify-typecheck.test.ts`.

**Produces:** A `typecheck` script using `tsc -b --noEmit`; separate correctly scoped desktop/data/web lint configurations; PR and main-push checks for unit tests, real checking, lint, Rust tests, formatting and strict Clippy. Keep release/deploy workflows separate.

- [x] Add a temporary type-error probe to an isolated checkout: assigning a string to a `number` in an included app file must cause the project check to exit nonzero. Restore/remove the probe afterward. The verification script must clean up in `finally`; test its cleanup on success and failure.
- [x] Change the script and show the same probe now fails. Confirm normal app and build-config projects pass. Implement the checker independently before the notification feature.
- [x] Exclude generated `build/`, `src-tauri/target/`, models and vendor assets from lint. Use the web project's own Next.js rules for `web/`; fix remaining first-party errors rather than globally disabling hooks/type rules.
- [x] Address existing Rust test/style findings in a mechanical, separate change; verify no runtime behavior change. Run formatting with review of the resulting diff.
- [x] Add PR CI for the supported Rust feature configurations, frontend checks and build. Pin agreed Bun/Rust/toolchain inputs consistently with release builds. Keep corpus/model-dependent tests in explicitly provisioned jobs.
- [x] Run the commands below; require success on the new head. Configuring repository required-check settings remains a separate integration action; no protection settings were changed.

```sh
bun run typecheck
bun run lint
bun run test --run
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
```

**Done when:** A seeded type error is caught; normal checks pass; generated/foreign-framework files do not create misleading failures; an open PR actually reports these jobs. No product PR is considered ready from an empty status rollup.

## Task 1: Stabilize translation identity and add Yoruba correctly

**Modify:** `src/stores/bible-store.ts`, `src/hooks/use-bible.ts`, `src/types/bible.ts`, Bible lookup commands/metadata, `data/build-bible-db.ts`, `data/download-sources.ts`, `data/prepare-embeddings.ts`, `data/ci-build.ts`, `src-tauri/tauri.conf.json`, notices UI/resources.

**Extend/create tests:** `src/stores/bible-store.test.ts`, our own `data/convert-yoruba-vpl.test.ts`, `data/bible-upgrade.test.ts`, `data/setup-freshness.test.ts`.

**Consumes:** Existing translation abbreviation and numeric runtime DB IDs.

**Produces:** Persisted primary/secondary translation codes resolved to current runtime IDs; versioned source/DB manifests; packaged Yoruba attribution. Preserve runtime numeric IDs internally if useful.

- [x] Reproduce the ID shift in a fixture: an old build selects ESV at ID 2; inserting OYCB before ESV must still restore ESV after rebuilding. Repeat with KJV/NIV and a missing optional source.
- [x] Migrate settings by verified prior-release DB mapping where available. Record the source release/manifest in new settings. A legacy numeric ID with ambiguous provenance must trigger a language reselection before automatic presentation; do not guess that ID 2 always means the same translation.
- [x] Write our own converter against the official source and validate it independently: canonical book mapping, Unicode/diacritics, nonempty text, verse references, duplicates and omitted verses. Record source version/hash and expected corpus counts from that version; the reviewed corpus had 66 books and 31,087 verses.
- [x] Make both setup entrypoints rebuild when the translation manifest changes, even if `rhema.db` exists. Test warm setup with no OYCB source, source-present/old-DB, fresh setup, failed download with intact previous DB, and idempotent rerun.
- [ ] Package the complete source/copyright/license notice with the installed data and make it accessible in the app. Inspect produced macOS/Windows/Linux artifacts, not only repository files.
- [ ] Run the data/store tests, all Task 0 checks, and an installed-app translation-selection/upgrade smoke test before proposing the independently implemented Yoruba change.

**Done when:** Existing language choices remain correct across upgrades, OYCB is queryable in fresh and warm setups, and attribution travels with the installed application. #106 remains open for Hausa/Igbo.

## Task 2: Implement numbered search and output safety independently

**Modify:** `src/lib/quick-search.ts`, its existing tests, `src/components/panels/live-output-panel.tsx`, `src/components/broadcast/output-card.tsx`, `src/lib/broadcast-output-control.ts`.

**Create tests:** `src/lib/broadcast-output-control.test.ts`, focused output-card/live-output component tests.

**Produces:** Fresh numbered-search and output-safety implementations covering the requirements reviewed in #181 and #180, without requiring the whole dashboard restructure.

- [x] For numbered search, add failing word-ordinal cases for First/Second/Third, all 17 numbered books, Arabic/Roman stored names, and Tab/autocomplete/reference parsing. Implement the promised forms with our own code and tests; preserve existing search behavior.
- [x] For output safety, seed a hidden `broadcast-*` renderer with failed NDI start and no visible projector. Going live must warn. Test visible display, active hidden NDI, disabled config and status-query rejection separately.
- [x] Base availability on reconciled visible-display or active-transport status. Clean up failed starts or retain them with an explicit failed state; the hidden window alone cannot count as success.
- [x] Test disable/delete while live, dismissed confirmation, explicit confirmation, delayed confirmation after state changes, double activation and already-stopped outputs. Assert exactly one stop and no accidental interruption of another output.
- [ ] Run focused tests, full checks and native output smoke, then open separate PRs for our implementations.

**Done when:** Promised search forms work, no-output warnings are accurate, and safety controls protect actual outputs through every equivalent action path.

Implementation evidence for Task 2 is in #188 and #189. Native macOS smoke passed;
Windows/Linux native UI, physical projector and receiver acceptance remain open.
The focused controller tests and real NDI start/cancel/stop smoke do not establish
#177 latency targets.

## Task 3: Extract app-owned session and operator/presentation controllers

**Modify:** `src/App.tsx`, `src/components/panels/transcript-panel.tsx`, `src/components/panels/search-panel.tsx`, `src/components/panels/live-output-panel.tsx`, `src/hooks/use-broadcast.ts`, `src/lib/remote-actions.ts`, `src/lib/remote-events.ts`, Rust API command/coercion/dispatch code and `documentation/remote-control.md`.

**Create:** `src/hooks/use-detection-session.ts`, `src/hooks/use-bible-navigation.ts`, `src/lib/operator-actions.ts`, `src/lib/presentation-controller.ts` and corresponding tests.

**Interfaces:** Keep `presentVerse(verse: Verse): Promise<void>` as a compatibility facade and `stepVerse(direction, options)` for stepping. Add shared `setAutoLive(enabled: boolean): void`, `toggleAutoLive(): void`, `setFollowDetections(enabled: boolean): void`, and `clearLive(mode: "transparent" | "black" | "background"): void`. All presentation intents share one revision gate; translation refresh must pass through it too.

- [ ] Add integration tests that hide/unmount Transcript and Bible panels while app controllers stay mounted; detections, reading advances, remotes and output-ready synchronization must continue exactly once.
- [ ] Extract event subscriptions and navigation completion from components into app-root controllers without changing behavior. Handle async subscription cleanup and StrictMode remounts.
- [ ] Add failing tests for #176's HTTP and OSC `bible_next/bible_prev` reaching the resulting live verse, including chapter boundaries, rapid presses and errors. Pass `{ present: true }` through the shared actions and add Auto toggle/set variants end to end.
- [ ] Add tests for #139: with follow off, an incoming detection cannot change the browsed book/chapter or scroll, even with auto live on. Keep preview/live policy separate; implement the follow control and preserve single-click presentation.
- [ ] Add explicit transparent-clear, black and background-only payloads. Test that clear invalidates a pending verse lookup and sends the correct pixels to every output without stopping its transport.
- [ ] Move translation refresh to the same presentation controller. Add deferred-promise tests: refresh A → present B → resolve A; first present → selection change; clear → old fetch completion; session reset → old event. Only latest valid intent can commit.
- [ ] Run frontend/API tests, native remote smoke and full checks. Update command documentation and tutorial language for the separate policies.

**Done when:** Panel visibility cannot stop app behavior; remote/UI actions agree; manual browsing and live output have independent ownership; stale asynchronous work cannot reclaim live output.

## Task 4: Reproduce and fix detection context failures

**Modify:** `src-tauri/crates/detection/src/direct/{detector,context,parser,fuzzy}.rs`, `reading_mode.rs`, `src-tauri/src/commands/stt.rs` only where a demonstrated cause requires it.

**Create:** `src-tauri/crates/detection/tests/session_replay.rs`, small annotated fixtures and a controllable clock seam for timeout-dependent context tests.

**Consumes:** Ordered final/partial text events, timestamps, session boundaries, accepted citations and active reading context.

**Produces:** Reproducible #175 regressions and a bounded, documented context-switch policy.

- [ ] Extract a minimal ordered reproduction from the attached log and annotate intended references. Use synthetic equivalent narration where possible; keep the full sermon log outside version control. Preserve timing and partial corrections; isolated strings already failed to reproduce the whole incident.
- [ ] Build the replay test to exercise direct detection plus reading-mode coordination, not only a parser. First reproduce the incorrect context switch or document the missing initial state; do not alter confidence thresholds by guesswork.
- [ ] Add cases for Obadiah as a person during 1 Kings, James/Titus in narration, English “is”, bare numbers/times, spoken verse-only continuations, contradictory corrections, long pauses and stop/restart. Include positive explicit citations to those same books.
- [ ] Fix the narrow proven context/continuation boundary. Keep ambiguous narration as a candidate without overwriting authoritative reading context. Preserve invalid-reference validation and existing alias regressions.
- [ ] Replay 10-, 30-, 60- and 120-minute sequences; assert bounded context/history, no unrelated accepted direct reference on negative fixtures, and correct recovery after explicit navigation/citation.
- [ ] Run `cargo test -p rhema-detection`, relevant STT command tests, all workspace checks and a recorded-sermon native smoke test.

**Done when:** The original sequence or its minimized equivalent is reproduced, the regression fails before the fix and passes afterward, positive citations remain accurate, and session longevity is tested. If initial state is still missing, retain #175 as investigated rather than closed.

## Task 5: Give suggestions a stable interaction model

**Modify:** `src/stores/detection-store.ts`, its tests, `src/components/panels/detections-panel.tsx`, `src/components/layout/dashboard.tsx` and tutorial steps.

**Create:** `src/lib/suggestion-history.ts`, `src/lib/suggestion-history.test.ts`, `src/components/panels/suggestions-panel.tsx`, focused component tests.

**Interface:** A pure history merge takes existing candidates, incoming candidates, `nowMs`, and `{ capacity: 25, retentionMs: 60000 }`; candidate identity contains source, translation code and canonical verse coordinates. The panel owns its visible snapshot and pending-update indicator; ingestion remains active.

- [ ] Write fake-clock tests for append, canonical dedupe, refresh/relevance ordering, expiry, dismissal and capacity. Assert ingestion never exceeds the configured bound.
- [ ] Implement history separately from the visible ranking. Keep source/method labels accurate for FTS-derived results; do not manufacture cosine percentages.
- [ ] Test hover, focus, held pointer and scrolling while five new candidates arrive. The interacted card and scroll position stay stable, with a pending count. Apply updates explicitly; do not remove or move the card underneath a click. Retain the inspected snapshot until interaction ends, then expire stale candidates.
- [ ] Extract the semantic/quotation Suggestions panel while retaining a distinct direct-detection view. Add limits/retention controls in detection settings with migration defaults. Keep newly arriving candidates available without automatic live presentation.
- [ ] Test responsive layout, keyboard focus, accessible pending announcements and tutorial targets. Verify hiding the panel leaves Task 3 controllers active.
- [ ] Run store/component tests, full checks, and a live operator interaction recording.

**Done when:** #145's candidate disappearance and click-target instability are prevented under continuous ingestion, with bounded memory and truthful score labels.

## Task 6: Measure and fix frame delivery; then reconsider idle fade

**Modify:** `src/broadcast-output.tsx`, `src-tauri/src/commands/broadcast.rs`, `src-tauri/crates/broadcast/src/ndi.rs`, output status/diagnostics, relevant broadcast stores.

**Create:** `src/lib/frame-delivery.ts`, its fake-clock/backpressure tests, `src-tauri/crates/broadcast/src/frame_pump.rs`, transport integration tests, `documentation/testing/broadcast-latency.md`.

**Interface:** Each rendered frame carries output ID, increasing content revision, dimensions and pixels. The native transport owns a bounded latest-frame slot, configured cadence, last-frame reuse, active/stopped state and completion/error telemetry. Clear/stop controls remain ordered and cannot be coalesced away by stale frames.

- [ ] Add trace IDs at accepted operator intent, verse resolve, output event, canvas render, IPC receipt and SDK send; measure receiver-frame appearance separately. Use a common recorder or synchronized clocks for cross-process comparisons; do not subtract unrelated monotonic clock origins.
- [ ] Establish a 100-change Windows/vMix baseline before changing cadence. Repeat visible and hidden renderer modes, one/two outputs, 720p/1080p and 24/30/60 fps. Record p50/p95/p99, frame revisions, dropped/coalesced counts, CPU and memory.
- [ ] Add a regression where a slow frame push overlaps later content changes: after it completes, the latest dirty revision must be delivered immediately without waiting for the two-second keepalive. Test terminal clear/stop and output isolation.
- [ ] Implement the bounded sender and negotiated binary/native-frame handoff. Avoid transporting unchanged full-resolution base64 pixels every frame. Repeat cached frames natively at the advertised rate; verify rational frame-rate metadata matches the selected mode.
- [ ] Prove #177's target on the documented setup: p95 ≤250 ms and p99 ≤500 ms after warmup over at least 100 changes, with no stale final frame. If receiver buffering dominates, document the measurement and receiver configuration rather than claiming an application fix.
- [ ] Only then port #179 behind disabled-by-default opt-in. Use a shared presentation timestamp/deadline, propagate timeout changes, and implement elapsed-time fade interpolation that completes at the declared duration.
- [ ] Add failed-before-fix tests for all surface/background/image opacity, alpha compositing, fade-in/out/reversal, settings edits and actual frame submissions during animation. Verify the terminal fade frame, hidden-window behavior and controller/output agreement. Themes and output sync must not extend content lifetime.
- [ ] Run native receiver checks on all supported platforms and Windows/vMix; retain separate results for NDI modes and projector output.

**Done when:** Frame delivery has measured receiver evidence, bounded work, correct backpressure and lifecycle behavior. Idle fade is independently opt-in and cannot silently alter ordinary manual operation.

## Task 7: Correct and integrate dual-language presentation

**Modify:** Our shared presentation controller and `src/hooks/use-broadcast.ts`, live/preview panels, Bible store, `src/lib/verse-renderer.ts`, render types, theme migration, text properties and designer canvas.

**Extend tests:** `use-broadcast.test.ts`, `verse-renderer.test.ts`, `bible-store.test.ts`, `theme-migrations.test.ts`; add designer component and multi-output integration tests.

**Consumes:** Task 1 stable translation identity and Task 3 presentation revision policy.

**Produces:** A single settled reference with valid primary and optional secondary text, separate per-language layout/plate metrics, and an offline designer sample that exercises both.

- [x] Add deferred tests for the first-present settings race, optional-secondary rejection, and old-refresh/new-present ordering. Primary content must survive optional lookup failure; obsolete selection snapshots cannot commit.
- [x] Resolve translations through the shared controller; validate reference and current translation codes at commit. Do not relabel cached content from another translation after failed lookup.
- [x] Add canvas tests that emit actual text fragments and record draw coordinates/styles. A secondary-only plate must add geometry and draw calls; its padding affects wrapping/fit. Either implement vertical alignment in a defined language region or remove the inert control.
- [x] Use a deliberate dual-language designer sample for render and selection metrics. Test that editing Secondary visibly changes the sample with live output off, while Primary stays unchanged.
- [x] Exercise Yoruba combining marks, long/short asymmetric text, different font sizes, delayed fonts/images, inherited secondary style, stacked/free mode, no-fit limits and reference placement.
- [ ] Test old-theme import, save/cancel, restart, secondary=None, primary=secondary normalization, partial translations, two output themes/resolutions, and an output opened after the last presentation.
- [ ] Run the full frontend suite and native projector/NDI checks before integrating our fresh dual-language implementation. Existing 227 passing tests on the reviewed head do not replace these regressions.

Our fresh [draft #197](https://github.com/openbezal/rhema/pull/197), head `91c505d`, is based on #196. Local gates: 461 frontend tests / 43 files, typecheck/lint/build, 394 Rust tests in each configuration, strict Clippy/fmt/diff check passed. One whole-branch review found overlapping primary/secondary/preview races and an inert Inline control; four regressions were observed RED then GREEN in one fix pass. Production browser Canvas/Fabric checks include independent style/plate/padding/drag/no-fit, a late simulated 720p output, full credits, 1024×600 layout and same-webview reload. Mocked Tauri/DB/window routing is explicit; integrated packaged native preference/window restart, platform visuals and physical receiver acceptance remain open. All five cross-platform CI jobs passed (run 38822051827).

**Done when:** Every visible secondary control has verified output behavior, designer preview matches rendering, language settings survive upgrade, and asynchronous selection/presentation races are covered.

## Task 8: Add unified keyboard operation

**Modify:** `src/lib/operator-actions.ts`, `src/hooks/use-remote-control.ts`, panel focus/list handling, tooltips and remote documentation.

**Create:** `src/lib/shortcut-registry.ts`, `src/hooks/use-keyboard-shortcuts.ts`, command-palette and shortcut-help components with interaction tests.

**Consumes:** Task 3 shared actions and Task 5 stable candidate identities.

- [ ] Write tests for Space/S/slash/Escape/help, `G` chords, modifier palette, focused-list movement/queue removal and bracket verse/chapter navigation. Add negative cases for input, textarea, role=textbox, nested contenteditable, IME, dialogs and held keys.
- [ ] Implement one declarative action/key/help registry; derive tooltips and the help overlay from it. Keep OS-global shortcut registration distinct from in-app listeners.
- [ ] Add command palette actions for translation selection, verse navigation, settings and remote server control. Only expose pinning after its semantics are implemented and tested; mark that #49 subrequest separately until then.
- [ ] Test identical final state for the same action from UI, keyboard, HTTP and OSC. Confirm focus moves to panels using stable targets and respects responsive tabs.
- [ ] Run component/browser tests and native shortcuts on macOS, Windows and Linux.

**Done when:** The implemented #49 layers are discoverable, safe while typing, and consistent across control surfaces; undefined actions are not advertised as working.

## Task 9: Complete portability, display preferences and remaining language scope

Treat the following as separate small PRs sharing stable identifiers, not one combined feature branch.

**9A — #140 session archive:** Create `src/lib/session-archive.ts`, versioned archive types, `src/components/panels/session-archive-panel.tsx` as a drawer, and round-trip/component tests. Reuse `theme-designer-files.ts`. Export final transcript TXT/JSON and queue/detection/settings/theme JSON; stage and validate import before mutation. Test malformed/future versions, Unicode, cancelled dialogs, partial writes, credential exclusion and missing device/monitor mappings. A failed import leaves current state intact; a failed write leaves the prior export intact.

**9B — #138 naming/reference/autocomplete:** Add stable-code/book-number display overrides and structured reference formatting in the renderer; use the same formatter for preview/designer/output. Keep the verse number in body text independently configurable from reference visibility. Test Revelation label overrides, `JA 2 2`, unique versus ambiguous completion, numbered books, translations and save/restart/export/import. No display preference may alter speech parsing or canonical lookup.

**9C — #106 Hausa/Igbo:** Verify each source's redistribution terms, attribution, stable mapping and corpus completeness before adding it to source manifests. Use separate converter/corpus/upgrade tests and installed-bundle checks. Treat the supplied Igbo URL as a lead until its content and terms are verified. Close the umbrella only when each requested language is supplied or its remaining dependency is explicitly tracked.

For each slice:

- [ ] Write the failing round-trip/formatting/corpus test with the cases above.
- [ ] Implement the smallest slice behind the established session/data boundary.
- [ ] Run focused tests, Task 0 checks and applicable packaged-app smoke tests.
- [ ] Record which exact issue subrequests are met; leave the rest open.

## Task 10: Resolve optional PRs and assess OMT

**10A — #174 notice:** After the typecheck part is integrated, rebase the remaining notification change. Add shared initial-check/in-flight state if multiple consumers otherwise repeat requests; test offline, API errors, malformed/current/newer versions, scoped URL opening, explicit retry and no repeated toast. Capture packaged-app visible evidence for newer/current cases without publishing a fake release or permanently changing the app version. No blocking static defect was found in this review; native evidence remains required.

**10B — #173 tooling:** Separate quantize argument validation from export-library selection. Add command-construction tests. Use a pinned export toolchain and test real export → quantize → Rust load → same-provenance index → representative search queries. Compare pooling and graph signatures deliberately: the review's tiny model proved different graph contracts but did not benchmark production quality. Regenerate embeddings if the approved model/pooling changes; reconcile the earlier revert before integration.

**10C — #52 prediction replacement:** Port onto the current architecture rather than resolving old conflicts mechanically. Use a pure predictor consuming validated session/reference context. Resolve complete real `Verse` objects, reject absent references and define chapter-end behavior against active translation data. Suggestions Add only queues; explicit Present uses the controller. Add command→queue→render tests, first/last verse/chapter, missing DB/text, no context, translation switch, reset and stale-event tests. Full frontend/native builds must pass; the old PR has demonstrated compile failures.

**10D — #178 OMT probe:** Use the official library behind Task 6's frame interface. Produce a small test sender plus receiver compatibility record for discovery, dynamic loading, packaging, 1080p alpha/cadence, reconnects and resource use. Test the user's intended receiver versions explicitly. Record a go/no-go and measured comparison; if it passes, prepare a separate OMT adapter implementation plan. No claim that OMT fixes NDI latency is justified before measurement.

## Task 11: Native acceptance and issue/PR closure evidence

**Create:** `tests/e2e/wdio.conf.ts`, desktop operator/outputs/session scenarios, `documentation/testing/release-acceptance.md` and a result manifest keyed by tested commit/package hashes.

- [ ] Provision a Tauri-compatible native WebDriver harness using the current official guide. If an embedded test bridge is used for macOS, compile it only into test builds; verify release artifacts exclude it. Add deterministic mocked-IPC browser coverage for fast workflow checks while retaining real native integration tests.
- [ ] Run Windows x64, macOS Apple Silicon and Linux x64 packaged smoke: launch, microphone permission/device, transcription, manual/auto operation, remotes, keyboard, search, queue, translation persistence, theme save/restore and multiple outputs.
- [ ] Exercise NDI receiver disconnect/reconnect, failed startup, monitor change, hidden renderer, 1080p alpha modes, delayed font/image load, clear, stop and restart. Require Windows/vMix evidence for #177 and record exact receiver/network settings.
- [ ] Run a two-hour service replay with interruptions, silence, prayers, corrections and manual overrides. Record crashes, stale/wrong content, interaction stalls, frame revisions and memory after warmup and at 30/60/120 minutes. Repeat the failure interval after any fix.
- [ ] Re-run checks against the actual integration commit and packages. Attach test evidence to each proposed PR/issue disposition when posting is authorized. Preserve scope distinctions: #182 does not complete all of #106; #181 does not complete all of #138; #52 is not a fix for disappearing semantic history.
- [ ] Prepare release notes and rollback instructions tied to artifact hashes. Treat merge/publish/closure as separate actions requiring the user's applicable authorization; this plan does not perform them.

**Done when:** Each issue/subrequest has recorded acceptance evidence, each integrated PR passes the new gates and relevant native checks, and remaining exploratory/source-dependent work is explicitly tracked rather than reported fixed.

## Coverage checklist

| Item | Owning task(s) |
| --- | --- |
| Issue #175 | 4, 11 |
| Issue #177 | 6, 11 |
| Issue #176 | 3, 8, 11 |
| Issue #145 | 5, 11 |
| Issue #139 | 3, 6, 11 |
| Issue #140 | 9A, 11 |
| Issue #138 | 2, 9B, 11 |
| Issue #106 | 1, 9C, 11 |
| Issue #49 | 3, 8, 11 |
| Issue #178 | 6, 10D |
| PR #181 | 2 |
| PR #180 | 2 |
| PR #182 | 1 |
| PR #183 | 3, 7 |
| PR #179 | 6 |
| PR #174 | 0, 10A |
| PR #173 | 10B |
| PR #52 | 5, 10C |

## Handoff

This plan delivers the requested review and proposed fix/testing sequence. The recommended first implementation slice is Task 0, followed by the small #181/#180 corrections and stable translation identity. Review the proposed architecture before restructuring panels; carry approved changes forward in small branches without starting a dashboard rewrite.
