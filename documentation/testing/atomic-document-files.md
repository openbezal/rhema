# Atomic document files

This foundation for issue #140 moves theme JSON import/export onto shared native document commands. Session archives, portable preference schemas and the new-session reset boundary remain subsequent work. It is an independent implementation based on our integration draft #200.

The webview supplies text, `json`/`text` format and a suggested name. Native dialogs select the actual file; no arbitrary read/write path is accepted by either command. Save returns `false` on cancellation and `true` only after replacement succeeds. Import returns `null` on cancellation and a basename/text pair on success. Errors propagate to the caller; the existing theme library logs those errors.

Writes validate the 64 MiB UTF-8 byte limit and JSON syntax before showing the save dialog. A temporary file in the destination directory receives the full content, retains an existing regular destination's permission bits, is flushed and synced, and is then atomically persisted over the destination. New files retain private defaults. A partial write or failed replacement leaves the prior destination intact; tests inspect both prior bytes and staging cleanup. This does not preserve ownership, extended ACLs or all filesystem metadata. The contract does not promise containing-directory durability across power loss or recovery from externally manipulated staging files.

Reads require a regular file, check its size, read at most the limit plus one byte, reject invalid UTF-8 and malformed JSON, and accept a UTF-8 BOM. JSON syntax checking does not enforce an archive/theme schema. Existing theme normalization and new-identity behavior are preserved; a complete schema validator belongs to the later staged-import slice. Unicode names remain readable, while dialog suggestions remove forbidden path/device-name forms and bound the UTF-8 filename length.

## Automated evidence

- Six theme-consumer tests cover exact Unicode export payload, explicit export cancellation, write errors, cancelled import, fresh imported identity/layout and malformed JSON. Only the native IPC/dialog/filesystem boundaries are mocked; theme parsing and normalization run normally.
- Fourteen native filesystem/validation tests on Unix cover exact Unicode replacement, retained shared-file permissions, injected partial write, failed rename, malformed/oversized export, plain-text newline preservation, BOM/Unicode import, strict UTF-8, invalid JSON, oversized/nonregular import, unknown format and portable default names. Filesystem cases use isolated temporary directories. The permissions test is Unix-only; other platforms run thirteen of these tests.
- The test-first native run failed on the missing document APIs; the frontend regressions failed against the old direct file-writing path. A filename expectation was corrected to exercise an internal control character rather than a newline removed by trimming. Test setup was corrected to avoid returning a mock function as Vitest cleanup.
- One whole-branch review identified the Unix permission regression and Windows-reserved suggestions after truncation / with superscript digits. Both were reproduced RED and fixed in one pass. Windows rules were checked against [Microsoft's filename documentation](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). No second review was requested.

Required checks: `bun run test --run`, `bun run typecheck`, `bun run verify:typecheck`, `bun run lint --max-warnings 0`, `bun run build`; `cargo test --workspace --locked` and `--no-default-features`, strict workspace Clippy, and `cargo fmt --all -- --check` from `src-tauri`.

Final local results: 729 frontend/data tests in 65 files and 445 Rust tests in each configuration on macOS, with all listed gates passing. See [source-specific result manifest](fixtures/atomic-document-files-results.json). The existing Vite large-chunk advisory remains. No other test failures are deferred.

## Native acceptance still required

Run on macOS, Windows and Linux with a separate test profile. Cancel both dialogs and confirm existing state/files stay unchanged. Export a theme with Yoruba/Igbo/Hausa text to a new file, replace an existing file, reopen it and compare its content. Test an unwritable destination and confirm the prior file remains readable. Import BOM JSON, malformed JSON and an oversized file; confirm failed import leaves the current theme intact. Verify overwrite confirmation, parent-window behavior, platform filename handling and packaged command routing. These manual dialog/package checks have not yet been performed for this branch. Filesystem unit tests and CI do not establish them.
