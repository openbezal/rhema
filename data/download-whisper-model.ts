/**
 * Downloads a whisper.cpp ggml model into models/whisper/.
 *
 * Default: ggml-small.en.bin
 * For a faster smoke test, run:
 *   WHISPER_MODEL=tiny.en bun run download:whisper-model
 *
 * Run: bun run download:whisper-model
 */

import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const MODELS_DIR = join(import.meta.dir, "..", "models", "whisper")
const BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

function normalizeModelName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("ggml-") && trimmed.endsWith(".bin")) {
    return trimmed
  }

  const stripped = trimmed.replace(/^ggml-/, "").replace(/\.bin$/, "")
  return `ggml-${stripped}.bin`
}

async function main() {
  const requestedModel = process.env.WHISPER_MODEL ?? process.argv[2] ?? "small.en"
  const fileName = normalizeModelName(requestedModel)
  const dest = join(MODELS_DIR, fileName)
  const url = `${BASE_URL}/${fileName}`

  await mkdir(MODELS_DIR, { recursive: true })

  const file = Bun.file(dest)
  if (await file.exists()) {
    console.log(`\n✓ whisper.cpp model already exists: ${dest}`)
    return
  }

  console.log(`\n=== Downloading whisper.cpp model: ${fileName} ===\n`)
  console.log(`Source: ${url}`)
  console.log(`Target: ${dest}\n`)

  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`Failed to download ${fileName}: HTTP ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  await Bun.write(dest, buffer)

  const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1)
  console.log(`\n✅ Saved ${dest} (${sizeMB} MB)\n`)
}

main().catch((err) => {
  console.error("❌ whisper.cpp model download failed:", err)
  process.exit(1)
})
