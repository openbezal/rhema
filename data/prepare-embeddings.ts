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
import { existsSync } from "node:fs"
import {
  ensurePythonEnv,
  getVenvBin,
  PROJECT_ROOT,
} from "./lib/python-env"

// ── Paths ────────────────────────────────────────────────────────────
const DATA_DIR = join(PROJECT_ROOT, "data")
const MODELS_DIR = join(PROJECT_ROOT, "models", "qwen3-embedding-0.6b")
const MODELS_DIR_INT8 = join(
  PROJECT_ROOT,
  "models",
  "qwen3-embedding-0.6b-int8"
)

const KJV_SOURCE = join(DATA_DIR, "sources", "KJV.json")
const NIV_SOURCE = join(DATA_DIR, "sources", "NIV.json")
const ESV_SOURCE = join(DATA_DIR, "sources", "ESV.json")
const CROSS_REFS = join(DATA_DIR, "cross-refs", "cross_references.txt")
const DB_PATH = join(DATA_DIR, "rhema.db")
const VERSES_JSON = join(DATA_DIR, "verses-for-embedding.json")
const EMB_BIN = join(PROJECT_ROOT, "embeddings", "kjv-qwen3-0.6b.bin")
const IDS_BIN = join(PROJECT_ROOT, "embeddings", "kjv-qwen3-0.6b-ids.bin")
const WHISPER_MODEL = join(PROJECT_ROOT, "models", "whisper", "ggml-large-v3-turbo-q8_0.bin")
const MODEL_ONNX = join(MODELS_DIR, "model.onnx")
const MODEL_INT8 = join(MODELS_DIR_INT8, "model_quantized.onnx")

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
  console.log("\n╔══════════════════════════════════════════════╗")
  console.log("║   Rhema – Full Setup Pipeline                ║")
  console.log("╚══════════════════════════════════════════════╝")
  if (force) console.log("  (--force: re-running all phases)\n")

  // ── Phase 1: Python environment ────────────────────────────────
  console.log("\n━━━ Phase 1/7: Python environment ━━━")
  await ensurePythonEnv([
    "optimum-onnx[onnxruntime]",
    "sentence-transformers",
    "accelerate",
    "tokenizers",
    "numpy",
    "torch",
    "meaningless",
  ])

  // ── Phase 2: Bible source data (pre-built zip + cross-refs) ────
  console.log("\n━━━ Phase 2/7: Download Bible source data ━━━")
  if (
    !shouldSkip(
      "Bible source data",
      KJV_SOURCE,
      NIV_SOURCE,
      ESV_SOURCE,
      CROSS_REFS
    )
  ) {
    await run(["bun", "run", join(DATA_DIR, "download-sources.ts")])
  }

  // ── Phase 3: Build Bible database ──────────────────────────────
  console.log("\n━━━ Phase 3/7: Build Bible database ━━━")
  if (!shouldSkip("Bible database", DB_PATH)) {
    await run(["bun", "run", join(DATA_DIR, "build-bible-db.ts")])
  }

  // ── Phase 4: ONNX model download + quantize ────────────────────
  console.log("\n━━━ Phase 4/7: ONNX model download & quantize ━━━")
  if (!shouldSkip("ONNX models", MODEL_ONNX, MODEL_INT8)) {
    const optimumCli = getVenvBin("optimum-cli")

    // Export FP32
    if (force || !existsSync(MODEL_ONNX)) {
      console.log(
        "\n  🧠 Exporting Qwen3-Embedding-0.6B to ONNX (feature-extraction)..."
      )
      console.log("     This may take a few minutes on first run.\n")
      await run([
        optimumCli,
        "export",
        "onnx",
        "--model",
        "Qwen/Qwen3-Embedding-0.6B",
        "--task",
        "feature-extraction",
        MODELS_DIR,
      ])
      console.log(`  ✓ Model exported to ${MODELS_DIR}`)
    }

    // Quantize to INT8
    if (force || !existsSync(MODEL_INT8)) {
      console.log("\n  ⚡ Quantizing to INT8 (ARM64)...")
      try {
        await run([
          optimumCli,
          "onnxruntime",
          "quantize",
          "--onnx_model",
          MODELS_DIR,
          "--arm64",
          "-o",
          MODELS_DIR_INT8,
        ])
        console.log(`  ✓ INT8 model saved to ${MODELS_DIR_INT8}`)
      } catch {
        console.error(
          "  ⚠️  Quantization failed. The FP32 model is still usable."
        )
      }
    }
  }

  // ── Phase 5: Export verses to JSON ─────────────────────────────
  console.log("\n━━━ Phase 5/7: Export verses to JSON ━━━")
  if (!shouldSkip("verses JSON", VERSES_JSON)) {
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
  if (!shouldSkip("precomputed embeddings", EMB_BIN, IDS_BIN)) {
    const venvPython = getVenvBin(
      process.platform === "win32" ? "python" : "python3"
    )
    // Use sentence-transformers + MPS GPU (much faster than ONNX CPU)
    await run(
      [venvPython, join(DATA_DIR, "precompute-embeddings.py")],
      undefined,
      { PYTHONUTF8: "1" }
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
  console.log("╚══════════════════════════════════════════════╝\n")
}

main().catch((err) => {
  console.error("\n❌ Pipeline failed:", err.message ?? err)
  process.exit(1)
})
