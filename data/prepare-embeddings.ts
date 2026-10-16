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

import { join } from "node:path"
import { ensureBibleAssets } from "./lib/bible-assets"
import { existsSync } from "node:fs"
import { ensurePythonEnv, PROJECT_ROOT } from "./lib/python-env"
import {
  EMBEDDING_REQUIREMENTS,
  EMBEDDING_MINIMUM_PYTHON,
  createEmbeddingPlan,
  prepareEmbeddingModels,
  isEmbeddingIndexCurrent,
  recordEmbeddingIndex,
} from "./lib/embedding-toolchain"

// ── Paths ────────────────────────────────────────────────────────────
const directoryIndex = process.argv.indexOf("--data-dir")
const DATA_DIR =
  directoryIndex >= 0
    ? process.argv[directoryIndex + 1]
    : join(PROJECT_ROOT, "data")
if (!DATA_DIR) throw new Error("--data-dir requires a directory")

const DB_PATH = join(DATA_DIR, "rhema.db")
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
  await ensureBibleAssets(DATA_DIR, { force })

  // ── Phase 4: ONNX model download + quantize ────────────────────
  console.log("\n━━━ Phase 4/7: ONNX model download & quantize ━━━")
  let modelFingerprint = ""
  if (!withEmbedding) {
    console.log("  ⏭ Skip: embedding assets are opt-in (--with-embedding)")
  } else {
    modelFingerprint = (await prepareEmbeddingModels({ force })).fingerprint
  }

  // ── Phase 5: Export verses to JSON ─────────────────────────────
  console.log("\n━━━ Phase 5/7: Export verses to JSON ━━━")
  if (!withEmbedding) {
    console.log("  ⏭ Skip: embedding assets are opt-in (--with-embedding)")
  } else {
    if (!existsSync(DB_PATH)) {
      console.error(
        "  ❌ rhema.db not found. Run phases 2-3 first (or remove --force skip)."
      )
      process.exit(1)
    }
    await run(["bun", "run", join(DATA_DIR, "compute-embeddings.ts")])
  }

  // ── Phase 6: Pre-compute embeddings ────────────────────────────
  console.log("\n━━━ Phase 6/7: Pre-compute verse embeddings ━━━")
  if (!withEmbedding) {
    console.log("  ⏭ Skip: embedding assets are opt-in (--with-embedding)")
  } else if (
    force ||
    !(await isEmbeddingIndexCurrent(PROJECT_ROOT, modelFingerprint))
  ) {
    // Use the Rust precompute binary — it embeds with the SAME ONNX model
    // and pooling the app uses at runtime and writes the provenance sidecar.
    // (The old sentence-transformers path produced vectors that did not
    // match the runtime embedder — that mismatch crippled vector search
    // until the 2026-08 regeneration.)
    await run(["bun", "run", "precompute:embeddings"])
    await recordEmbeddingIndex(PROJECT_ROOT, modelFingerprint)
  } else {
    console.log(
      "  Verified index model/source/binary hashes; skipping pre-computation."
    )
  }

  // ── Phase 7: Whisper model ────────────────────────────────────
  console.log("\n━━━ Phase 7/7: Download Whisper model ━━━")
  if (!shouldSkip("Whisper model", WHISPER_MODEL)) {
    await run(["bun", "run", join(DATA_DIR, "download-whisper-model.ts")])
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
