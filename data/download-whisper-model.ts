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

  const response = await fetch(MODEL_URL, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0)
  const totalMB = (totalBytes / 1_000_000).toFixed(0)
  console.log(`Size: ${totalMB} MB`)

  const writer = createWriteStream(MODEL_PATH + ".tmp")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  let downloaded = 0
  let lastPercent = -1

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    writer.write(Buffer.from(value))
    downloaded += value.byteLength

    const percent = totalBytes > 0 ? Math.floor((downloaded / totalBytes) * 100) : 0
    if (percent !== lastPercent && percent % 5 === 0) {
      process.stdout.write(`\r  ${percent}% (${(downloaded / 1_000_000).toFixed(0)}/${totalMB} MB)`)
      lastPercent = percent
    }
  }

  writer.end()
  await new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve)
    writer.on("error", reject)
  })

  // Atomic rename
  const { renameSync } = await import("node:fs")
  renameSync(MODEL_PATH + ".tmp", MODEL_PATH)

  console.log(`\nWhisper model downloaded: ${MODEL_PATH}`)
}

main().catch((e) => {
  console.error("Failed to download Whisper model:", e)
  process.exit(1)
})
