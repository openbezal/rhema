import { createHash } from "node:crypto"
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import source from "../yoruba-source.json"
import { convertYorubaVpl, validateYorubaCorpus } from "../convert-yoruba-vpl"

export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export type YorubaSourceSpec = typeof source
export type SourceFetcher = (url: string, options?: RequestInit) => Promise<Response>
interface SourceOptions {
  spec?: YorubaSourceSpec
  fetcher?: SourceFetcher
  extract?: (archive: string, entry: string) => Promise<Uint8Array>
}
async function extractEntry(archive: string, entry: string): Promise<Uint8Array> {
  const process = Bun.spawn(["unzip", "-p", archive, entry], { stdout: "pipe", stderr: "pipe" })
  const [output, error, status] = await Promise.all([
    new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited,
  ])
  if (status !== 0) throw new Error(`Cannot extract Yoruba source: ${error}`)
  return new Uint8Array(output)
}

/** Validate everything before replacing a source file that a working DB may depend on. */
export async function ensureYorubaSource(directory: string, options: SourceOptions = {}): Promise<void> {
  const spec = options.spec ?? source
  const destination = join(directory, "OYCB.json")
  try {
    if (sha256(await readFile(destination)) === spec.jsonSha256) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const staging = await mkdtemp(join(directory, ".yoruba-"))
  try {
    const response = await (options.fetcher ?? fetch)(spec.archiveUrl, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Yoruba source download failed: HTTP ${response.status}`)
    const archive = new Uint8Array(await response.arrayBuffer())
    if (sha256(archive) !== spec.archiveSha256) throw new Error("Yoruba archive checksum changed; review the source version before updating it")
    const archivePath = join(staging, "source.zip")
    await writeFile(archivePath, archive)
    const bytes = await (options.extract ?? extractEntry)(archivePath, spec.vplEntry)
    if (sha256(bytes) !== spec.vplSha256) throw new Error("Yoruba VPL checksum differs from the pinned source")
    const converted = convertYorubaVpl(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    validateYorubaCorpus(converted)
    const json = JSON.stringify(converted) + "\n"
    if (sha256(json) !== spec.jsonSha256) throw new Error("Converted Yoruba data differs from the reviewed conversion")
    const stagedJson = join(staging, "OYCB.json")
    await writeFile(stagedJson, json)
    await rename(stagedJson, destination)
  } finally { await rm(staging, { recursive: true, force: true }) }
}
