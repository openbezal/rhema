/**
 * Downloads the Whisper large-v3-turbo Q8_0 GGML model for local speech-to-text.
 *
 * Model: ggml-large-v3-turbo-q8_0.bin (~394MB)
 * Source: https://huggingface.co/ggerganov/whisper.cpp
 *
 * Run: bun run download:whisper
 */

import { join } from "node:path"
import { existsSync, mkdirSync, createWriteStream } from "node:fs"

const PROJECT_ROOT = join(import.meta.dir, "..")
const MODELS_DIR = join(PROJECT_ROOT, "models", "whisper")
const MODEL_FILE = "ggml-large-v3-turbo-q8_0.bin"
const MODEL_PATH = join(MODELS_DIR, MODEL_FILE)
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`

async function main() {
  if (existsSync(MODEL_PATH)) {
    console.log(`Whisper model already exists: ${MODEL_PATH}`)
    return
  }

  mkdirSync(MODELS_DIR, { recursive: true })

  console.log(`Downloading Whisper model from ${MODEL_URL}`)
  console.log(`Destination: ${MODEL_PATH}`)

  const tempPath = MODEL_PATH + ".tmp"
  
  const proc = Bun.spawn([
    "curl",
    "-L",
    "-C", "-",
    "--retry", "10",
    "--retry-delay", "5",
    "-o", tempPath,
    MODEL_URL
  ], {
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Download failed with exit code ${exitCode}`)
  }

  // Atomic rename
  const { renameSync } = await import("node:fs")
  renameSync(tempPath, MODEL_PATH)

  console.log(`\nWhisper model downloaded: ${MODEL_PATH}`)
}

main().catch((e) => {
  console.error("Failed to download Whisper model:", e)
  process.exit(1)
})
