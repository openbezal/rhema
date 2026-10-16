import { Database } from "bun:sqlite"
import { currentBibleManifest } from "../build-bible-db"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"

interface AssetOptions { force?: boolean; download?: () => Promise<void> }
async function run(script: string, directory: string): Promise<void> {
  const child = Bun.spawn(["bun", script, "--data-dir", directory], { stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) throw new Error(`Bible asset command failed: ${script}`)
}

export function bibleDatabaseIsCurrent(directory: string): boolean {
  let database: Database | undefined
  try {
    database = new Database(join(directory, "rhema.db"), { readonly: true })
    const stored = database.query("SELECT value FROM rhema_metadata WHERE key = ?").get("source_manifest") as { value: string } | null
    return stored?.value === JSON.stringify(currentBibleManifest(directory))
  } catch { return false }
  finally { database?.close() }
}

export async function ensureBibleAssets(directory: string, options: AssetOptions = {}): Promise<boolean> {
  await mkdir(join(directory, "sources"), { recursive: true })
  await (options.download ?? (() => run(join(import.meta.dir, "../download-sources.ts"), directory)))()
  if (!options.force && bibleDatabaseIsCurrent(directory)) return false
  await run(join(import.meta.dir, "../build-bible-db.ts"), directory)
  return true
}
