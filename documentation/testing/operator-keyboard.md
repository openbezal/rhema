# Operator keyboard workflows

The app root owns one in-app keyboard listener. `shortcut-registry.ts` defines bindings, action identifiers, labels and groups; help, palette hints and relevant control titles consume that registry. Panels expose stable focus/list/action targets. Presentation, Queue navigation and on-air changes use the same operator actions as HTTP/OSC, including the existing output-safety confirmation. Tauri's OS-global plugin remains a separate owner; this branch registers no OS-global keys.

| Context | Keys | Behavior |
| --- | --- | --- |
| Operator | Space / S | Toggle on-air / transcription |
| Discoverability | ? / Mod+K | Open help / searchable commands |
| Search | / | Open Book search and focus its input |
| Panels | G then T/Q/S/D/P/L | Transcript / Queue / Search / Detections / Preview / Live |
| Reading | [ / ] / { / } | Present previous/next verse/chapter |
| Focused list | J/K or Down/Up | Move focus without presenting |
| Focused card | Enter | Present through its verified action |
| Queue card | Mod+Enter | Present and clear selection, retaining the row |
| Queue card | Delete / Backspace | Remove and focus the nearest surviving row |
| Escape | Context dependent | Close current dialog; clear quick completion, then blur editor; outside editors/dialogs, stop reading mode |

Mod means Command on macOS or Control on Windows/Linux. Chords expire after one second and cancel on focus/pointer/IME changes. Editable controls, nested contenteditable, IME, menus/dialogs, consumed events, held keys and unconfigured OS modifiers do not invoke operator verbs. A focused button/switch/link keeps its native Space/Enter activation. List navigation works for Queue, direct detections, Suggestions, Bible verses and context-search results.

The palette includes installed translation codes (resolved again at execution), complete verified verse browsing, themes, settings sections, Queue/Present preview, Auto live, explicit clear modes and HTTP/OSC start/stop. Browsing a verse alone never presents it or changes on-air state. Chapter navigation probes real rows and retains the current chapter at missing boundaries. Explicit browsing intent also protects its later chapter load from a newer command. Native server status and start/stop operations are serialized per server; Settings and palette share that service.

Queue navigation now locates the last live verse by canonical coordinates, independent of display labels/translation suffixes. Insert/remove/reorder retain active item identity. Queue references use a separate line from attribution/actions so the actual reference remains readable at minimum width. There is no implemented drag interaction, so the old decorative drag grip was removed. Bible reveal scrolls only its own list, preserving the focused operator panel in the outer narrow workspace.

Pinning (`P`) is deliberately absent from commands/help until its product/state semantics are defined. Issue #49 remains an umbrella with that subrequest and platform acceptance open.

## Verification

Local gates: **507 frontend tests / 40 files**, typecheck, lint and production build; **382 Rust tests in each configuration**, strict Clippy, formatting and diff checks. Rust source is unchanged. Native first-party artifacts were cleaned before switching the shared build cache to this branch.

New tests cover binding/chord/focus/IME/modifier negatives; actual shared presentation actions; canonical Queue navigation and identity; chapter boundaries/stale results; stable palette translations and verified browsing; native server idempotence/failure recovery; actual mounted palette selection and focus release; Queue/list actions; input/popup typing; layered Escape; and scoped verse-reveal geometry. Browser-discovered connecting-stop, empty-input Escape and outer-scroll defects were reproduced, regressed and fixed before review.

[Structured browser observations](fixtures/keyboard-browser-results.json) distinguish the evidence from native acceptance. Production Dashboard/components/fonts/Canvas ran at 1280×720 and 1024×600. Tauri/database/windows/audio/servers were mocked. No microphone, native sender or OSC/HTTP socket server was started. Real keyboard input exercised Queue chords/focus/Present/selection clearing/removal, on-air action, start/stop, palette typing/translation/verse/theme/settings/server commands, bracket navigation, missing chapter hold, slash, Escape, help scrolling and narrow panel focus. The final detection card remained fully visible after presentation (357–473px within a 600px viewport).

| Evidence | View |
| --- | --- |
| [Command palette](assets/keyboard-palette.jpg) | Shared commands and key hints |
| [Minimum help](assets/keyboard-help-minimum.jpg) | 1024×600 overlay |
| [Complete list help](assets/keyboard-help-list-minimum.jpg) | Scrollable discovery |
| [Focused detection](assets/keyboard-detections-minimum.jpg) | Scoped reveal preserves visibility |
| [Minimum Queue](assets/keyboard-queue-minimum.jpg) | Readable reference, source and focused actions |
| [Remote settings](assets/keyboard-remote-settings-minimum.jpg) | Mock server status reconciled by Settings polling |

Retained [TSX](fixtures/keyboard-browser-fixture.tsx.txt) and [HTML](fixtures/keyboard-browser-fixture.html.txt) are documentation fixtures, excluded from production lint/type compilation. To reproduce, copy them to `.qa-keyboard.tsx` and `.qa-keyboard.html` at the root, temporarily add `keyboardQa: path.resolve(__dirname, ".qa-keyboard.html")` to Vite's build input, build, and preview on a separate loopback origin. Remove the entry/files afterward. The tested fixture/tab/server were cleaned up and the viewport reset.

Packaged native typing/IME/focus on macOS, Windows and Linux, real provider lifecycle, physical outputs and the actual integrated stack remain acceptance work. This branch is based on our Suggestions stack #195; bilingual/transport and native lifecycle siblings will be integrated and reverified separately. No existing PR or issue is merged or closed by this work.

## Final branch review

One fresh whole-branch review found three Important defects and no Critical/Minor findings. All three were reproduced before the single fix pass:

- Buffered chapter input could acquire a new presentation ticket after a newer Clear. Navigation batches now retain an opaque controller owner; Clear, a new presentation, translation changes and other reserved intents revoke the batch. A new key after cancellation gets an independent batch so a stalled old lookup cannot block it. Regressions cover cancelled buffered input, uninterrupted rapid stepping and fresh input during the abandoned lookup.
- Palette input `1 John 1:1` rejected Roman and numeric catalog names. Exact catalog names/abbreviations and input now use the same normalization, with a unique book match and verified database coordinates required. Numbered aliases, attached abbreviations and ambiguous normalized names are covered.
- A stale Mod+Enter could clear a newer selection of the same Queue item. The primary presentation supplies an operation-specific commit receipt and Queue selection has a revision even when selecting the same row again. Selection clears only for the successful owning operation. Failed lookups retain selection even when old live coordinates happen to match.

The four reviewer regressions failed before changes; the extended set finished 12/12. The full post-review frontend suite, typecheck, lint and production build passed. Rust source is unchanged from the previously passing native gates. No second branch review was requested.
