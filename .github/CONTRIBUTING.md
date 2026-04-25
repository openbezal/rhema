# Rhema Contributing Guide

Hi! We're really excited that you're interested in contributing to Rhema. Before submitting your contribution, please read through this guide.

Rhema is a Tauri v2 desktop app. The frontend is React 19 + TypeScript + Tailwind + Zustand; the backend is a Rust workspace with seven crates under `src-tauri/crates/` (audio, STT, Bible/FTS, verse detection, NDI broadcast, Tauri command API, and notes). Bun is the package manager and the runtime for the data pipeline scripts. Contributions on either side are welcome.

## Table of contents

1. [Getting started](#getting-started)
2. [Repository layout](#repository-layout)
3. [Development workflow](#development-workflow)
4. [Commit message format](#commit-message-format)
5. [Quality gates](#quality-gates)
6. [Code standards](#code-standards)
7. [How to pick up an issue](#how-to-pick-up-an-issue)
8. [Pull request expectations](#pull-request-expectations)
9. [Getting help](#getting-help)
10. [Code of Conduct](#code-of-conduct)

## Getting started

1. Install the platform prerequisites. See [Prerequisites](../README.md#prerequisites) and [Platform-specific setup](../README.md#platform-specific-setup) in the README. Windows needs an extra LLVM + CMake bootstrap before anything else will compile — don't skip it.

2. [Fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo) the repository, clone your fork, and install JavaScript dependencies:

   ```sh
   bun install
   ```

3. Run the Tauri dev shell:

   ```sh
   bun run tauri dev
   ```

   This starts the Vite dev server and launches the desktop app. The first Rust build takes a while; later runs are incremental.

### Bible data, models, and embeddings

Much of Rhema's behavior depends on artifacts that aren't checked into the repo: the SQLite Bible database, copyrighted translations, the Qwen3 ONNX embedding model, and precomputed verse embeddings. For anything touching verse detection, Bible search, or rendering, you'll want these in place.

One command sets everything up (idempotent — it skips phases that are already complete):

```sh
bun run setup:all
```

See [Quick Setup](../README.md#quick-setup-recommended) for the full phase-by-phase breakdown and [Running individual setup steps](../README.md#running-individual-setup-steps) to rebuild only one piece (e.g. the SQLite DB or the ONNX model).

If you're only changing UI code or Rust logic that doesn't need real verse data, you can skip the heavy setup.

### Optional: NDI SDK

Broadcast output via NDI requires the NDI 6 SDK. It's only needed if you're working on `rhema-broadcast` or the Theme Designer's live output path.

```sh
bun run download:ndi-sdk
```

## Repository layout

```
rhema/
├── src/              React frontend (components, hooks, Zustand stores, lib)
├── src-tauri/        Rust workspace
│   ├── crates/
│   │   ├── audio         cpal-based capture, VAD, metering
│   │   ├── stt           Deepgram (WS + REST), local Whisper
│   │   ├── bible         SQLite + FTS5, cross-references
│   │   ├── detection     Direct parsing, semantic search, ensemble merger
│   │   ├── broadcast     NDI output via FFI
│   │   ├── api           Tauri command layer
│   │   └── notes         (placeholder)
│   └── tauri.conf.json
├── data/             Bible + model data pipeline (TypeScript + Python)
└── documentation/    Feature-level docs (e.g. remote-control.md)
```

The README has a deeper [Project Structure](../README.md#project-structure) tree and a [Tech Stack](../README.md#tech-stack) table if you need more orientation.

## Development workflow

Frontend and top-level commands:

| Command | What it does |
|---|---|
| `bun run tauri dev` | Run the full app (Vite + Tauri) |
| `bun run tauri build` | Produce a platform installer |
| `bun run dev` | Run the frontend only on the Vite dev server |
| `bun run build` | `tsc -b && vite build` |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | ESLint |
| `bun run format` | Prettier (with the Tailwind plugin) |
| `bun run test` | Vitest (frontend unit tests) |

Rust commands — run from `src-tauri/`:

| Command | What it does |
|---|---|
| `cargo check` | Fast compile check across the workspace |
| `cargo clippy --all-targets` | Lint the whole workspace |
| `cargo fmt` | rustfmt |
| `cargo test` | Unit tests across all crates |
| `cargo test -p rhema-detection` | Tests for one crate |

### Debugging

- **Frontend**: open devtools in the Tauri window (`Cmd/Option+I` on macOS, `F12` elsewhere) to inspect React state, Zustand stores, and the console.
- **Rust / Tauri commands**: commands log through the `log` crate via `tauri-plugin-log`. Turn on verbose logging with `RUST_LOG`:

  ```sh
  RUST_LOG=rhema_detection=debug,rhema_stt=debug bun run tauri dev
  ```

- **STT and verse detection pipelines** are async and streaming. Filtering logs by module (`RUST_LOG=rhema_detection=trace`) is usually faster than stepping through a debugger.

## Commit message format

Commits must follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

### Types

| Type       | When to use                                      |
|------------|--------------------------------------------------|
| `feat`     | A new feature or capability                      |
| `fix`      | A bug fix                                        |
| `refactor` | Code restructuring with no behavior change       |
| `chore`    | Build, tooling, CI, or maintenance tasks         |
| `docs`     | Documentation only                               |
| `test`     | Adding or updating tests                         |
| `perf`     | Performance improvement                          |
| `style`    | Formatting, whitespace — no logic change         |

### Rules

- Use the imperative mood ("add", "fix", "remove" — not "added", "fixes", "removed").
- Keep the first line under 72 characters.
- Describe **what the commit does and why**, not the files it touches — `git diff` shows the files.
- No emoji, no gitmoji. Plain text.
- Don't reference internal planning artifacts, phase numbers, or AI tooling. The history is for the project.

### Examples

```
feat: add verse bookmarking with offline sync
fix: prevent crash when Bible translation has missing chapters
refactor: extract audio playback into shared service
perf: lazy-load translation files to reduce startup time
fix: voice navigation skipping last verse in chapter (fix #42)
```

## Quality gates

Run these before you open a PR. There are no pre-commit hooks wired up, so the responsibility is on you.

**Frontend**

```sh
bun run typecheck
bun run lint
bun run test            # if your change affects tested code
```

**Rust** (from `src-tauri/`)

```sh
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo test
```

**Manual**

- If the change affects UI, run `bun run tauri dev` and exercise the feature. Type checks don't catch visual regressions.
- If you touch audio, STT, or detection, run at least one end-to-end pass with a real audio input — the pipelines are timing-sensitive and easy to break subtly.
- If you touch broadcast/NDI, verify the output in a receiver (OBS NDI plugin, Studio Monitor, etc.) on the platform you changed.

## Code standards

- **TypeScript / React**: Prettier (with `prettier-plugin-tailwindcss`) handles formatting; ESLint handles lint. Follow the patterns already in the codebase — Zustand for state, `@/` path alias for imports, shadcn/ui primitives in `src/components/ui/`, hooks under `src/hooks/`.
- **Rust**: `cargo fmt` formats, `cargo clippy` lints. Treat clippy warnings as errors for contributed code. Prefer the ownership and error patterns already present in the workspace; don't introduce a new async runtime, error-handling crate, or serialization library without discussing it first.
- **Comments**: write them only when the *why* is non-obvious. Don't restate what the code does. Don't reference the issue, PR, or AI tooling — that context belongs in the PR description.
- **Stylistic refactors**: PRs that rearrange code purely for "readability" are usually declined. Readability is subjective, the diffs are noisy, and `git blame` suffers. Refactors that fix a bug, unblock a feature, or measurably improve performance are welcome — ideally as a separate PR.
- **Dependencies**: adding a new runtime dependency (either a JS package or a Rust crate) is a commitment. Prefer a few lines of direct code over a transitive dependency tree. If a dep genuinely belongs, call it out in the PR description with the reason.
- **Security**: treat `src-tauri/tauri.conf.json` (CSP, capabilities) and the Tauri command surface as security boundaries. See [SECURITY.md](./SECURITY.md) — don't loosen the CSP to unblock a dev tool.

## How to pick up an issue

- You don't need permission to work on an open issue. Browse the [issue list](https://github.com/openbezal/rhema/issues) and start.
- If an issue looks good but you want to confirm the approach before spending time, leave a comment describing the direction you plan to take. A one-line "I'm picking this up" is not required and doesn't reserve the issue.
- If two people end up working on the same thing, the later PR can still be useful as a second pair of eyes — review, validate, or merge ideas.
- For non-trivial features, open a discussion or issue **before** the PR. Getting alignment on scope first saves rewrites later.

## Pull request expectations

- Branch from `main` and merge back into `main`.
- Make the PR about **one thing**. If you spot unrelated cleanup while working, save it for a follow-up PR.
- Fill in the [PR template](./PULL_REQUEST_TEMPLATE.md). "Areas affected" and "Tested on" are load-bearing for reviewers — don't skip them.
- **New features** need a convincing reason. If there isn't an issue with maintainer agreement that the feature is wanted, open one (or a discussion) before writing code.
- **Bug fixes**: reference the issue in the PR title if one exists, e.g. `fix: handle missing NDI library on Linux (fix #123)`. Include reproduction steps. Add test coverage when practical.
- **UI changes**: include a screenshot or a short recording. The PR template has a slot for it.
- **Cross-platform work**: Rhema ships on macOS, Windows, and Linux. If you only tested on one, say so — the "Tested on" checklist is how we know.
- **PR title** must follow the [Commit message format](#commit-message-format). It becomes the merge commit message and shows up in release notes.
- Multiple small commits during review are fine; they'll be squashed on merge.

### Things we're unlikely to merge

- Large stylistic refactors with no behavior change.
- Non-trivial changes with no tests and no manual test plan.
- Features that haven't been agreed on ahead of time.
- AI-generated PRs the author doesn't understand — see below.

### AI tool policy

AI coding assistants are fine — many contributors (and maintainers) use them. The expectations are:

- **You are responsible for everything you submit**, regardless of how it was generated. Read it, understand it, and test it before opening the PR.
- **Don't use AI to write PR descriptions or reply to review comments.** Reviewers spend real time on PRs; auto-generated replies waste that time.
- **Don't ship "vibe-coded" PRs** — plausible-looking diffs that you couldn't explain or modify yourself. These are the fastest way to have a PR closed.
- **Commit messages**: no references to AI tooling, agents, or prompt metadata. The history is for the project, not the workflow that produced it.

## Getting help

- **Questions, ideas, general discussion** — [GitHub Discussions](https://github.com/openbezal/rhema/discussions).
- **Bugs and feature requests** — use the [issue templates](https://github.com/openbezal/rhema/issues/new/choose). A reproduction (short recording, minimal repo, or precise steps) speeds triage considerably.
- **Security vulnerabilities** — don't open a public issue. Follow the process in [SECURITY.md](./SECURITY.md).

## Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

Thanks for contributing!
