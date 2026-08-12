/**
 * Downloads the Qwen3-Embedding-0.6B ONNX model exported for feature-extraction.
 *
 * IMPORTANT: The onnx-community export has KV cache inputs (text-generation format).
 * We need to export it ourselves using optimum-cli with --task feature-extraction.
 *
 * This script automatically:
 *   1. Verifies Python >= 3.9.0 is available
 *   2. Creates a .venv if one doesn't exist
 *   3. Installs optimum-onnx[onnxruntime] into the venv
 *   4. Runs optimum-cli to export and quantize the model
 *
 * Run: bun run download:model
 */

import { join } from "node:path"
import {
  ensurePythonEnv,
  getVenvBin,
  PROJECT_ROOT,
} from "./lib/python-env"

const MODELS_DIR = join(PROJECT_ROOT, "models", "qwen3-embedding-0.6b")
const MODELS_DIR_INT8 = join(
  PROJECT_ROOT,
  "models",
  "qwen3-embedding-0.6b-int8"
)

async function main() {
  // --- Phase 1: Python environment setup ---
  await ensurePythonEnv([
    "optimum-onnx[onnxruntime]",
    "sentence-transformers",
    "accelerate",
  ])

  // --- Phase 2: Export model ---
  const optimumCli = getVenvBin("optimum-cli")

  console.log(
    "\n🧠 Exporting Qwen3-Embedding-0.6B to ONNX (feature-extraction)...\n"
  )
  console.log(
    "  This downloads the model from HuggingFace and converts it to ONNX format."
  )
  console.log(
    "  The export uses --task feature-extraction to avoid KV cache inputs."
  )
  console.log("  This may take a few minutes on first run.\n")

  const proc = Bun.spawn(
    [
      optimumCli,
      "export",
      "onnx",
      "--model",
      "Qwen/Qwen3-Embedding-0.6B",
      "--task",
      "feature-extraction",
      MODELS_DIR,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    }
  )

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error("\n❌ Export failed.")
    process.exit(1)
  }

  console.log(`\n✅ Model exported to ${MODELS_DIR}\n`)

  // --- Phase 3: Quantize to INT8 for ARM64 (Apple Silicon) ---
  console.log("\n⚡ Quantizing model to INT8 (ARM64)...\n")
  console.log("  This reduces the model from ~2.4GB to ~571MB.")
  console.log("  Dynamic INT8 quantization preserves >99% embedding quality.\n")

  const quantizeProc = Bun.spawn(
    [
      optimumCli,
      "onnxruntime",
      "quantize",
      "--onnx_model",
      MODELS_DIR,
      "--arm64",
      "-o",
      MODELS_DIR_INT8,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    }
  )

  const quantizeExitCode = await quantizeProc.exited
  if (quantizeExitCode !== 0) {
    console.error("\n⚠️  Quantization failed. The FP32 model is still usable.")
    console.error("   To quantize manually: bun run quantize:model")
  } else {
    console.log(`\n✅ INT8 model quantized to ${MODELS_DIR_INT8}\n`)
  }

  console.log("  Files created:")
  console.log("  - model.onnx (FP32, feature-extraction, no KV cache)")
  console.log("  - model_quantized.onnx (INT8, ARM64-optimized)")
  console.log("  - tokenizer.json")
}

main().catch((err) => {
  console.error("❌ Failed:", err)
  process.exit(1)
})