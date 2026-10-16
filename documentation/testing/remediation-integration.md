# Combined remediation branch

This branch combines our independently reviewed implementations before adding archive/reset and portable display preferences. It starts from keyboard #198 and integrates our native session #194, bilingual/frame #197/#196, numbered search #188, and Bible data #199/#187. Remote controls #185 and the shared session/Suggestions/output-safety foundations are already ancestors. No original PR implementation was copied or cherry-picked, and no PR/issue was merged or closed on GitHub.

The merge resolutions preserve both keyboard focus/hints and bilingual preview, primary commit receipts, native trace propagation, opaque navigation-batch ownership, optional-language cancellation and normalized search suffixes. Two native reading test fixtures needed the new attribution/score fields after the lifecycle and Suggestions changes were combined; the compiler reproduced that incompatibility before the fixtures were updated.

## Cross-branch defects fixed

Queue Mod+Enter originally awaited the presentation function's optional language lookup after the primary had already committed. With an eight-second secondary lookup this held selection unnecessarily. A new regression failed before changing Queue completion to resolve at the operation-specific verified primary commit. The optional text can still enrich the current presentation later; it cannot undo a newer Clear or selection.

The actual combined screenshot exposed a misleading header: its OFF AIR label tracked transcription while the live-output switch was on. The header now explicitly reports TRANSCRIPTION ON/OFF. Three mounted TransportBar regressions failed first and now verify the independent transcription/broadcast combinations.

## Evidence

[Source/head and local gate results](fixtures/remediation-integration-results.json): **719 frontend/data tests across 62 files**, typecheck, lint and normal production build; **431 Rust tests in each default/no-default configuration**, strict Clippy and formatting. First-party native artifacts were cleaned before switching the shared cache to this source. Branch whitespace verification allows original publisher HTML CRLF bytes (`git -c core.whitespace=cr-at-eol diff --check`). A seeded application type-error probe also verifies that the combined typecheck still checks application source.

[Browser results](fixtures/integration-browser-results.json) use the actual integrated App, app-owned listeners/controllers, components, fonts and Canvas at **1024×600**. Tauri/database/windows/audio/HTTP/OSC are mocked; no provider, native app or physical receiver ran. Checks cover primary commit before delayed secondary, Clear retaining ownership after the delayed response, stable-code BIUO activation, presenting a KJV-attributed Queue row in the selected BIUO primary with BSRK optional text, numeric/Roman numbered-book browsing without changing live, matching native-backed Settings selection, complete Igbo notices, accepted-connecting transcription Stop and distinct header status.

The [combined bilingual view](assets/integration-bilingual-minimum.png) and [transcription-only view](assets/integration-transcription-only.png) show the corrected final header. [Primary commit](assets/integration-primary-commit.png), [pending clear](assets/integration-clear-pending-secondary.png) and [nested notices](assets/integration-notices-minimum.png) were captured before the caption correction; their presentation behavior is unchanged. The retained [TSX](fixtures/integration-browser-fixture.tsx.txt)/[HTML](fixtures/integration-browser-fixture.html.txt) fixture is documentation only, excluded from normal compilation. Both temporary tabs/servers were closed, viewport overrides reset, root fixture files removed and Vite input restored before the final normal build.

## Remaining work

Search still re-evaluates an outstanding typed reference on primary-language changes and can reclaim preview after a later Queue selection. This is tracked under Task 9B's explicit browsing/async ownership work; in the combined check the cleared live output remained intact. This integration is a foundation for that next slice, not a claim that all audited behavior is complete.

Archive/reset, portable display preferences, optional tooling/update/prediction/OMT scope and native acceptance remain. Windows/macOS/Linux packaged workflows, real provider events, recorded-sermon longevity and physical Windows/vMix frame targets require separate evidence. Earlier SDK-only latency and branch-specific package results do not establish this combined head's full-app or physical receiver performance. Idle fade remains deferred behind the receiver target.
