# Rhema

Real-time AI-powered Bible verse detection for live sermons and broadcasts. A Tauri v2 desktop app with a React frontend and Rust backend.

Rhema listens to a live sermon audio feed, transcribes speech in real time, detects Bible verse references (both explicit citations and quoted passages), and renders them as broadcast-ready overlays via NDI for live production.

## Features

- **Real-time speech-to-text** via Deepgram (WebSocket streaming + REST fallback)
- **Multi-strategy verse detection**
  - Direct reference parsing (Aho-Corasick automaton + fuzzy matching)
  - Semantic search (Qwen3-0.6B ONNX embeddings + HNSW vector index)
  - Quotation matching against known verse text
  - Cloud booster (optional, OpenAI/Claude)
  - Sermon context tracking and sentence buffering
- **SQLite Bible database** with FTS5 full-text search
- **Multiple translations** — KJV, NIV, ESV, NASB, NKJV, NLT, AMP + Spanish, French, Portuguese
- **Cross-reference lookup** (340k+ refs from openbible.info)
- **NDI broadcast output** for live production integration
- **Theme designer** — visual canvas editor for verse overlays with backgrounds (solid, gradient, image), text styling, positioning, shadows, and outlines
- **Verse queue** with drag-and-drop ordering
- **Fuzzy contextual search** (Fuse.js client-side)
- **Audio level metering**, live indicator, and session timer

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Zustand, Vite 7 |
| **Backend** | Tauri v2, Rust (workspace with 7 crates) |
| **AI/ML** | ONNX Runtime (Qwen3-0.6B embeddings), Aho-Corasick, Fuse.js |
| **Database** | SQLite via rusqlite (bundled) with FTS5 |
| **Broadcast** | NDI 6 SDK via dynamic loading (libloading FFI) |
| **STT** | Deepgram WebSocket + REST (tokio-tungstenite) |

### Rust Crates

| Crate | Purpose |
|---|---|
| `rhema-audio` | Audio device enumeration, capture, VAD (cpal) |
| `rhema-stt` | Deepgram STT streaming + REST fallback |
| `rhema-bible` | SQLite Bible DB, FTS5 search, cross-references |
| `rhema-detection` | Verse detection pipeline: direct, semantic, quotation, ensemble merger, sentence buffer, sermon context, reading mode |
| `rhema-broadcast` | NDI video frame output via FFI |
| `rhema-api` | Tauri command API layer |
| `rhema-notes` | (placeholder) |

## Prerequisites

- [Bun](https://bun.sh/) (runtime for scripts + package manager)
- [Rust](https://rustup.rs/) toolchain (stable, 1.77.2+)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) (platform-specific system dependencies)
- [Python 3](https://www.python.org/) (for downloading copyrighted translations and embedding model export)
- [Deepgram API key](https://deepgram.com/) (for speech-to-text)

## Getting Started

```bash
git clone <repo-url>
cd rhema
bun install
```

### Quick Setup (recommended)

One command sets up everything — Python virtual environment, Bible data, copyrighted translations, database, ONNX model, and precomputed embeddings:

```bash
bun run setup:all
```

This runs 7 phases in sequence, skipping any that are already complete:

1. Python environment setup (`.venv` + all pip dependencies)
2. Download open-source Bible data (KJV, Spanish, French, Portuguese + cross-references)
3. Download copyrighted translations from BibleGateway (NIV, ESV, NASB, NKJV, NLT, AMP)
4. Build SQLite Bible database (`data/rhema.db` with FTS5 + cross-references)
5. Download & export ONNX model (Qwen3-Embedding-0.6B) + INT8 quantization
6. Export KJV verses to JSON for embedding
7. Precompute verse embeddings (auto-selects GPU if available, falls back to ONNX CPU)

### Environment

Create a `.env` file in the project root:

```
DEEPGRAM_API_KEY=your_key_here
```

### NDI SDK (optional)

For broadcast output via NDI:

```bash
bun run download:ndi-sdk
```

### Running individual setup steps

Each phase can also be run independently:

```bash
bun run download:bible-data          # Public domain translations + cross-refs
python3 data/download-biblegateway.py  # Copyrighted translations (needs .venv)
bun run build:bible                  # Build SQLite database
bun run download:model               # Download & export ONNX model
bun run export:verses                # Export verses to JSON
python3 data/precompute-embeddings.py  # Precompute embeddings (GPU or ONNX fallback)
```

### Run in development

```bash
bun run tauri dev
```

### Build for production

```bash
bun run tauri build
```

## Project Structure

```
rhema/
├── src/                          # React frontend
│   ├── components/
│   │   ├── broadcast/            # Theme designer, NDI settings
│   │   ├── controls/             # Transport bar
│   │   ├── layout/               # Dashboard layout
│   │   ├── panels/               # Transcript, preview, live output, queue, search, detections
│   │   └── ui/                   # shadcn/ui + custom components
│   ├── hooks/                    # useAudio, useTranscription, useDetection, useBible, useBroadcast
│   ├── stores/                   # Zustand stores (audio, transcript, bible, queue, detection, broadcast, settings)
│   ├── types/                    # TypeScript type definitions
│   └── lib/                      # Context search (Fuse.js), verse renderer (Canvas 2D), builtin themes
├── src-tauri/                    # Rust backend (Tauri v2)
│   ├── crates/
│   │   ├── audio/                # Audio capture & metering (cpal)
│   │   ├── stt/                  # Deepgram STT (WebSocket + REST)
│   │   ├── bible/                # SQLite Bible DB, search, cross-references
│   │   ├── detection/            # Verse detection pipeline
│   │   │   ├── direct/           # Aho-Corasick + fuzzy reference parsing
│   │   │   └── semantic/         # ONNX embeddings, HNSW index, cloud booster, ensemble
│   │   ├── broadcast/            # NDI output (FFI)
│   │   ├── api/                  # Tauri command layer
│   │   └── notes/                # (placeholder)
│   └── tauri.conf.json
├── data/                         # Bible data pipeline
│   ├── prepare-embeddings.ts     # Unified setup orchestrator (bun run setup:all)
│   ├── lib/python-env.ts         # Shared Python venv management utilities
│   ├── download-sources.ts       # Download public domain translations + cross-refs
│   ├── download-biblegateway.py  # Download copyrighted translations (NIV, ESV, etc.)
│   ├── build-bible-db.ts         # Build SQLite DB from JSON sources
│   ├── compute-embeddings.ts     # Export verses to JSON for embedding
│   ├── precompute-embeddings.py  # Precompute embeddings (GPU auto-detect, ONNX fallback)
│   ├── download-model.ts         # Export & quantize Qwen3 ONNX model
│   ├── download-ndi-sdk.ts       # Download NDI SDK libraries
│   └── schema.sql                # Database schema
├── models/                       # ML models (gitignored)
├── embeddings/                   # Precomputed vectors (gitignored)
├── sdk/ndi/                      # NDI SDK files (downloaded)
└── build/                        # Vite build output
```

## Scripts

| Script | Description |
|---|---|
| `setup:all` | **Full setup** — runs all data/model/embedding phases (idempotent) |
| `dev` | Start Vite dev server (port 3000) |
| `build` | TypeScript check + Vite production build |
| `tauri` | Run Tauri CLI commands |
| `test` | Run Vitest tests |
| `lint` | ESLint |
| `format` | Prettier formatting |
| `typecheck` | TypeScript type checking |
| `preview` | Preview production build |
| `download:bible-data` | Download public domain Bible translations + cross-references |
| `build:bible` | Build SQLite Bible database from JSON sources |
| `download:model` | Export Qwen3-Embedding-0.6B to ONNX + quantize to INT8 |
| `export:verses` | Export KJV verses to JSON for embedding precomputation |
| `precompute:embeddings` | Precompute embeddings via Rust ONNX binary |
| `precompute:embeddings-onnx` | Precompute embeddings via Python ONNX Runtime |
| `precompute:embeddings-py` | Precompute embeddings via Python sentence-transformers |
| `quantize:model` | Quantize ONNX model to INT8 for ARM64 |
| `download:ndi-sdk` | Download NDI 6 SDK headers and platform libraries |

## Environment Variables

Create a `.env` file in the project root:

| Variable | Required | Description |
|---|---|---|
| `DEEPGRAM_API_KEY` | Yes | API key for Deepgram speech-to-text |
