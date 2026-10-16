/// <reference types="bun-types" />
/**
 * Export KJV verse rows from the selected SQLite database for native precompute.
 * Run: bun run export:verses --data-dir /path/to/data
 * Use bun run precompute:embeddings for the guarded model/export/index pipeline.
 */

import { Database } from "bun:sqlite"
import { join, resolve } from "node:path"

const directoryIndex = process.argv.indexOf("--data-dir")
const directoryArgument =
  directoryIndex >= 0 ? process.argv[directoryIndex + 1] : import.meta.dir
if (!directoryArgument || directoryArgument.startsWith("--"))
  throw new Error("--data-dir requires a directory")
const DATA_DIR = resolve(directoryArgument)
const DB_PATH = join(DATA_DIR, "rhema.db")
const OUTPUT_PATH = join(DATA_DIR, "verses-for-embedding.json")

async function main() {
  console.log("\n📖 Exporting KJV verses for embedding...\n")

  const db = new Database(DB_PATH, { readonly: true })

  // Local row IDs vary across prepared databases; select the stable edition.
  const verses = db
    .query(
      "SELECT v.id, v.book_name, v.chapter, v.verse, v.text FROM verses v JOIN translations t ON t.id = v.translation_id WHERE t.abbreviation = 'KJV' ORDER BY v.id"
    )
    .all() as Array<{
    id: number
    book_name: string
    chapter: number
    verse: number
    text: string
  }>

  console.log(`  Found ${verses.length} KJV verses`)
  if (verses.length === 0) {
    db.close()
    throw new Error("The selected database has no KJV verses")
  }

  // Write to JSON for the Rust precompute binary
  const output = verses.map((v) => ({
    id: v.id,
    text: v.text,
    ref: `${v.book_name} ${v.chapter}:${v.verse}`,
  }))

  await Bun.write(OUTPUT_PATH, JSON.stringify(output))
  console.log(`  ✓ Exported to ${OUTPUT_PATH}`)
  console.log(
    `\n  Next: Run the Rust precompute binary to generate embeddings.`
  )
  console.log(
    `  This requires the ONNX model to be downloaded first (bun run data/download-model.ts)\n`
  )

  db.close()
}

main().catch((err) => {
  console.error("❌ Export failed:", err)
  process.exit(1)
})
