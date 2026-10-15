# Optional dual-language presentation

This branch extends our controller and frame-transport stack. Primary remains the native active translation. Secondary is an optional installed, unambiguous translation code; its default is None. Both are persisted together in the existing version-1 preference record. Missing, duplicate, unavailable or primary-equal secondary choices resolve to None.

A verified primary row commits without waiting for the optional lookup. A secondary response may attach only to its original presentation intent, reference and translation selection. Failure leaves the primary visible and reports a warning. Changing a language refreshes the current reference without taking the output live. None removes optional text immediately and invalidates pending optional work.

## Geometry and design

Single-language rendering keeps its existing path. Dual rendering allocates separate primary and secondary regions with independent font, color, alignment, plate, padding and fit. Stacked layouts expose primary share and language gap. Free layouts expose three boxes: Primary, Secondary and Reference. Legacy free layouts retain their shared verse area until independent boxes are created. Each language clips to its region and reports when its minimum font cannot fit; the reference also clips to its allocated region.

The Designer deliberately uses Genesis 1:1 in KJV and the official Open Yoruba Contemporary Bible even when live output is off or Secondary is None. Bitmap rendering, Fabric selection and box seeding use the same 1920×1080 workspace transformation. Sample credits bundle the complete OYCB notice from `data/licenses/OYCB-NOTICE.txt`; see the [publisher](https://ebible.org/Scriptures/yor_vpl.zip). The sample retains Yoruba combining marks. The optional style inherits Primary until explicitly edited, and can be reset to inheritance. Discard, close and switching drafts restore the corresponding saved output theme.

## Browser evidence

[Structured observations](fixtures/bilingual-browser-results.json) describe the checks and limitations. The browser used the production build and actual production components, bundled fonts, Canvas text renderer and Fabric interactions. Tauri IPC, database access, native windows and event routing were mocked. The corpus contains two real KJV/OYCB verses from our own #187 data import. No microphone, native broadcast sender or receiver was used.

The browser exercised default None/off-air behavior; two-language presentation; a late 720p consumer; optional failure; reordered requests; None during an optional lookup; independent typography, alignment, image plate and padding; actual Fabric selection/dragging; no-fit clipping; save/discard/close; nested full-license credits; minimum 1024×600 window; a 1280×720 theme; and same-webview reload with persisted selection and current presentation. The temporary entry was removed after the checks. The preview server and tab were closed and the viewport override reset.

| Evidence | View |
| --- | --- |
| [Two-language output](assets/bilingual-live-desktop.jpg) | Live preview and simulated consumers |
| [Optional failure](assets/bilingual-optional-failure.jpg) | Primary succeeds independently |
| [Secondary image plate](assets/bilingual-designer-image.jpg) | Independent font/color/plate |
| [Independent drag](assets/bilingual-designer-drag.jpg) | Three free regions |
| [No-fit](assets/bilingual-designer-no-fit.jpg) | Secondary warning/clipping |
| [Minimum window](assets/bilingual-designer-minimum.jpg) | 1024×600 with wrapped status |
| [720p sample](assets/bilingual-designer-720p-minimum.jpg) | Scaled workspace |
| [Reload](assets/bilingual-after-reload.jpg) | Restored selection and on-air verse |
| [Credits](assets/bilingual-credits.jpg) | Full notice dialog |

For reproduction, copy [the retained TSX source](fixtures/bilingual-browser-fixture.tsx.txt) to `.qa-bilingual.tsx` and [HTML](fixtures/bilingual-browser-fixture.html.txt) to `.qa-bilingual.html` at the repository root. Temporarily add `bilingualQa: resolve(__dirname, ".qa-bilingual.html")` to Vite's `build.rollupOptions.input`, then run `bun run build` and `bun run preview --host 127.0.0.1 --port 3176`. Use an isolated browser profile/origin; the fixture persists only prefixed QA local-storage data plus the production same-webview session snapshot. Remove the temporary entry and files afterward. The retained fixture is documentation, deliberately excluded from production compilation/lint. It is not a substitute for packaged native tests.

## Automated gates

The regression matrix covers stable-code rebinding and paired preference writes; deferred primary/secondary ordering and selection invalidation; preview source identity; inherited/nested style migration; real text fragments including Yoruba combining marks; two resolutions; stacked/free/reference placements; plate padding/wrap/fit; alignment; signed letter spacing; delayed font readiness; independent designer controls; free-box round trip; and draft discard/close/switch output resync. Tests were first observed failing for the newly fixed behaviors. Baseline monolingual renderer/migration cases remain in the suite.

Run the branch's regular gates:

```sh
bun run test --run
bun run typecheck
bun run lint
bun run build
cargo test --manifest-path src-tauri/Cargo.toml --workspace
cargo test --manifest-path src-tauri/Cargo.toml --workspace --no-default-features
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
git diff --check
```

## Acceptance still required

Integrated native preference restart, real renderer-window late/reload behavior with both languages, Windows/Linux visual checks and physical receiver/operator latency remain unverified for this branch. The direct NDI probe on the parent branch excludes the bilingual canvas and application IPC. No issue or original PR is closed, and no physical receiver or full platform acceptance is claimed.
