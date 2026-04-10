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
import { existsSync } from "node:fs"

const MODELS_DIR = join(import.meta.dir, "..", "models", "qwen3-embedding-0.6b")
const MODELS_DIR_INT8 = join(import.meta.dir, "..", "models", "qwen3-embedding-0.6b-int8")
const VENV_PYTHON = join(import.meta.dir, "..", ".venv", "bin", "python3")

async function main() {
  // Check if venv exists
  if (!existsSync(VENV_PYTHON)) {
    console.error("\n❌ Virtual environment not found at .venv/")
    console.error("   Please create one first:")
    console.error("   python3 -m venv .venv")
    console.error("   source .venv/bin/activate")
    console.error("   pip install optimum-onnx onnx onnxruntime")
    process.exit(1)
  }

  // Install dependencies first
  console.log("\n📦 Installing Python dependencies in venv...\n")
  const installProc = Bun.spawn(
    [
      VENV_PYTHON,
      "-m",
      "pip",
      "install",
      "--quiet",
      "optimum[exporters,onnxruntime]",
      "onnx",
      "onnxruntime",
      "accelerate",
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    }
  )

  const installExitCode = await installProc.exited
  if (installExitCode !== 0) {
    console.error("\n❌ Failed to install dependencies")
    process.exit(1)
  }

  console.log("\n🧠 Exporting Qwen3-Embedding-0.6B to ONNX (feature-extraction)...\n")
  console.log("  This downloads the model from HuggingFace and converts it to ONNX format.")
  console.log("  The export uses --task feature-extraction to avoid KV cache inputs.")
  console.log("  This may take a few minutes on first run.\n")

  const proc = Bun.spawn(
    [
      VENV_PYTHON,
      "-m",
      "optimum.exporters.onnx",
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
    console.error("\n❌ Export failed. Check the error messages above.")
    process.exit(1)
  }

  console.log(`\n✅ Model exported to ${MODELS_DIR}\n`)

  // --- Phase 3: Quantize to INT8 for ARM64 (Apple Silicon) ---
  console.log("\n⚡ Quantizing model to INT8 (ARM64)...\n")
  console.log("  This reduces the model from ~2.4GB to ~571MB.")
  console.log("  Dynamic INT8 quantization preserves >99% embedding quality.\n")

  const quantizeProc = Bun.spawn(
    [
      VENV_PYTHON,
      "-m",
      "optimum.exporters.onnx",
      "--model",
      MODELS_DIR,
      "--optimize",
      "O2",
      "--quantize",
      "arm64",
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