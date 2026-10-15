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
 * Every phase is idempotent: if its output artifacts already exist it is
 * skipped. Pass --force to re-run everything regardless.
 *
 * Run: bun run setup:all
 *      bun run setup:all --force
 */

import { join } from "node:path"
import { ensureBibleAssets } from "./lib/bible-assets"
import { existsSync } from "node:fs"
import { ensurePythonEnv, PROJECT_ROOT } from "./lib/python-env"

// ── Paths ────────────────────────────────────────────────────────────
const directoryIndex = process.argv.indexOf("--data-dir")
const DATA_DIR = directoryIndex >= 0 ? process.argv[directoryIndex + 1] : join(PROJECT_ROOT, "data")
if (!DATA_DIR) throw new Error("--data-dir requires a directory")

const DB_PATH = join(DATA_DIR, "rhema.db")
const VERSES_JSON = join(DATA_DIR, "verses-for-embedding.json")

const force = process.argv.includes("--force")

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
  if (process.argv.includes("--bible-only")) {
    await ensureBibleAssets(DATA_DIR, { force })
    return
  }
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   Rhema – Bundle Setup Pipeline                ║")
  console.log("╚══════════════════════════════════════════════╝")
  if (force) console.log("  (--force: re-running all phases)\n")

  // ── Phase 1: Python environment ────────────────────────────────
  console.log("\n━━━ Phase 1/4: Python environment ━━━")
  await ensurePythonEnv([
    "optimum-onnx[onnxruntime]",
    "sentence-transformers<5.0.0",
    "accelerate",
    "tokenizers",
    "numpy",
    "torch",
    "meaningless",
  ])

  // Always verify required sources, then compare the DB's content manifest.
  console.log("\n━━━ Bible sources and database freshness ━━━")
  await ensureBibleAssets(DATA_DIR, { force })

  // Embedding re-ranking assets (ONNX model + verse embeddings) are
  // deliberately NOT built for release bundles: they are optional, cost
  // ~2.5h of compute, and the app degrades to full-quality FTS + reference
  // search without them. Users opt in locally with
  // `bun run setup:all --with-embedding`.

  // ── Phase 4: Export verses to JSON ─────────────────────────────
  console.log("\n━━━ Phase 4/4: Export verses to JSON ━━━")
  if (!shouldSkip("verses JSON", VERSES_JSON)) {
    if (!existsSync(DB_PATH)) {
      console.error(
        "  ❌ rhema.db not found. Run phases 2-3 first (or remove --force skip)."
      )
      process.exit(1)
    }
    await run(["bun", "run", join(DATA_DIR, "compute-embeddings.ts")])
  }

  // ── Done ───────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   ✅ Setup complete!                          ║")
  console.log("╚══════════════════════════════════════════════╝\n")
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message ?? err)
  process.exit(1)
})
