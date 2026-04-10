/**
 * Downloads the Qwen3-Embedding-0.6B ONNX model exported for feature-extraction.
 *
 * IMPORTANT: The onnx-community export has KV cache inputs (text-generation format).
 * We need to export it ourselves using optimum-cli with --task feature-extraction.
 *
 * This script runs the optimum-cli export, which requires Python with optimum-onnx and onnxruntime installed:
 *   pip install optimum-onnx onnxruntime
 *
 * Run: bun run data/download-model.ts
 */

import { join } from "node:path"

const MODELS_DIR = join(import.meta.dir, "..", "models", "qwen3-embedding-0.6b")
const MODELS_DIR_INT8 = join(import.meta.dir, "..", "models", "qwen3-embedding-0.6b-int8")

async function main() {
  console.log("\n🧠 Exporting Qwen3-Embedding-0.6B to ONNX (feature-extraction)...\n")
  console.log("  This downloads the model from HuggingFace and converts it to ONNX format.")
  console.log("  The export uses --task feature-extraction to avoid KV cache inputs.")
  console.log("  This may take a few minutes on first run.\n")

  const proc = Bun.spawn(
    [
      "optimum-cli",
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
    console.error("\n❌ Export failed. Make sure optimum-onnx is installed:")
    console.error("   pip install optimum-onnx onnxruntime")
    process.exit(1)
  }

  console.log(`\n✅ Model exported to ${MODELS_DIR}\n`)

  // Step 2: Quantize to INT8 for ARM64 (Apple Silicon)
  console.log("\n⚡ Quantizing model to INT8 (ARM64)...\n")
  console.log("  This reduces the model from ~2.4GB to ~571MB.")
  console.log("  Dynamic INT8 quantization preserves >99% embedding quality.\n")

  const quantizeProc = Bun.spawn(
    [
      "optimum-cli",
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
