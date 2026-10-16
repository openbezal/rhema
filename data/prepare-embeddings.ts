/**
 * Unified pipeline: sets up everything needed for Rhema from scratch.
 *
 *   Phase 1 – Python environment (.venv + all pip deps)
 *   Phase 2 – Download Bible data (pre-built zip + cross-refs)
 *   Phase 3 – Build rhema.db (SQLite + FTS5)
 *   Phase 4 – Download & export ONNX model + INT8 quantization
 *   Phase 5 – Export KJV verses to JSON
 *   Phase 6 – Pre-compute verse embeddings
 *   Phase 7 – Download Whisper model for local STT
 *
 * Model and index reuse requires matching integrity/provenance receipts.
 * Other phases retain their existing freshness rules. Pass --force to rebuild.
 *
 * Run: bun run setup:all
 *      bun run setup:all --force
 */

import { join, resolve } from "node:path"
import { ensureBibleAssets } from "./lib/bible-assets"
import { existsSync } from "node:fs"
import { ensurePythonEnv, PROJECT_ROOT } from "./lib/python-env"
import {
  EMBEDDING_REQUIREMENTS,
  EMBEDDING_MINIMUM_PYTHON,
  createEmbeddingPlan,
  prepareEmbeddingAssets,
} from "./lib/embedding-toolchain"

// ── Paths ────────────────────────────────────────────────────────────
const directoryIndex = process.argv.indexOf("--data-dir")
const requestedDirectory =
  directoryIndex >= 0
    ? process.argv[directoryIndex + 1]
    : join(PROJECT_ROOT, "data")
if (!requestedDirectory || requestedDirectory.startsWith("--"))
  throw new Error("--data-dir requires a directory")
const DATA_DIR = resolve(requestedDirectory)

const WHISPER_MODEL = join(
  PROJECT_ROOT,
  "models",
  "whisper",
  "ggml-large-v3-turbo-q8_0.bin"
)

const force = process.argv.includes("--force")

// Embedding re-ranking assets (ONNX model + verse embeddings) are OPTIONAL
// and expensive to build (~2.5h compute, ~3.3GB disk, Python toolchain).
// Keyword + reference search works fully without them, so their phases only
// run when explicitly requested.
const withEmbedding = process.argv.includes("--with-embedding")

// ── Helpers ──────────────────────────────────────────────────────────
function shouldSkip(label: string, ...artifacts: string[]): boolean {
  if (force) return false
  const allExist = artifacts.every((p) => existsSync(p))
  if (allExist) {
    console.log(`  ⏭ Skip: ${label} (artifacts already exist)`)
  }
  return allExist
}

async function run(
  cmd: string[],
  cwd?: string,
  extraEnv?: Record<string, string>
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    cwd: cwd ?? PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd.join(" ")}`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify(createEmbeddingPlan(PROJECT_ROOT), null, 2))
    return
  }
  if (process.argv.includes("--bible-only")) {
    await ensureBibleAssets(DATA_DIR, { force })
    return
  }
  if (process.argv.includes("--embedding-only")) {
    await ensurePythonEnv(EMBEDDING_REQUIREMENTS, EMBEDDING_MINIMUM_PYTHON)
    await prepareEmbeddingAssets({ dataDir: DATA_DIR, force })
    return
  }
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   Rhema – Full Setup Pipeline                ║")
  console.log("╚══════════════════════════════════════════════╝")
  if (force) console.log("  (--force: re-running all phases)\n")
  if (!withEmbedding) {
    console.log(
      "  Embedding re-ranking assets will be SKIPPED (optional, ~2.5h to build)."
    )
    console.log(
      "  Keyword + reference search works fully without them. To opt in:"
    )
    console.log("    bun run setup:all --with-embedding\n")
  }

  // ── Phase 1: Python environment ────────────────────────────────
  // Only the embedding phases (4-6) consume the Python toolchain.
  console.log("\n━━━ Phase 1/7: Python environment ━━━")
  if (withEmbedding) {
    await ensurePythonEnv(EMBEDDING_REQUIREMENTS, EMBEDDING_MINIMUM_PYTHON)
  } else {
    console.log("  ⏭ Skip: only needed for --with-embedding")
  }

  // Always verify required sources, then compare the DB's content manifest.
  console.log("\n━━━ Bible sources and database freshness ━━━")
  if (!withEmbedding) await ensureBibleAssets(DATA_DIR, { force })

  // One lease owns models, selected source, staged native index and receipt.
  console.log("\n━━━ Phases 4–6/7: Embedding models and matching index ━━━")
  if (!withEmbedding) {
    console.log("  ⏭ Skip: embedding assets are opt-in (--with-embedding)")
  } else {
    await prepareEmbeddingAssets(
      { dataDir: DATA_DIR, force },
      undefined,
      async () => {
        await ensureBibleAssets(DATA_DIR, { force })
      }
    )
  }

  // ── Phase 7: Whisper model ────────────────────────────────────
  console.log("\n━━━ Phase 7/7: Download Whisper model ━━━")
  if (!shouldSkip("Whisper model", WHISPER_MODEL)) {
    await run([
      "bun",
      "run",
      join(PROJECT_ROOT, "data/download-whisper-model.ts"),
    ])
  }

  // ── Done ───────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   ✅ Setup complete!                          ║")
  console.log("╚══════════════════════════════════════════════╝")
  if (!withEmbedding) {
    console.log("  Note: embedding re-ranking assets were skipped (optional).")
    console.log(
      "  Gain: better paraphrase search in the Context tab. Cost: ~2.5h build,"
    )
    console.log(
      "  ~3.3GB disk, ~600-900MB RAM at runtime. Opt in anytime with:"
    )
    console.log("    bun run setup:all --with-embedding\n")
  } else {
    console.log("")
  }
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message ?? err)
  process.exit(1)
})
