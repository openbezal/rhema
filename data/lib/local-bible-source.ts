import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import pinned from "../local-bible-sources.json"
import { convertBibleVpl, validateBibleCorpus } from "../convert-bible-vpl"
import { sha256, type SourceFetcher } from "./yoruba-source"

export { sha256 }
export const LOCAL_BIBLE_SOURCES = pinned
export type LocalBibleSourceSpec = (typeof pinned)[number]
interface SourceOptions {
  fetcher?: SourceFetcher
  extract?: (archive: string, entry: string) => Promise<Uint8Array>
}
async function extractEntry(
  archive: string,
  entry: string
): Promise<Uint8Array> {
  const process = Bun.spawn(["unzip", "-p", archive, entry], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, error, status] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (status !== 0) throw new Error(`Cannot extract Bible source: ${error}`)
  return new Uint8Array(output)
}

/** Each edition is pinned independently; no partially validated bytes replace a source. */
export async function ensureLocalBibleSource(
  directory: string,
  spec: LocalBibleSourceSpec,
  options: SourceOptions = {}
): Promise<void> {
  const destination = join(directory, `${spec.code}.json`)
  try {
    if (sha256(await readFile(destination)) === spec.jsonSha256) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const staging = await mkdtemp(join(directory, `.bible-${spec.code}-`))
  try {
    const response = await (options.fetcher ?? fetch)(spec.archiveUrl, {
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok)
      throw new Error(
        `${spec.code} source download failed: HTTP ${response.status}`
      )
    const archive = new Uint8Array(await response.arrayBuffer())
    if (sha256(archive) !== spec.archiveSha256)
      throw new Error(
        `${spec.code} archive checksum changed; review the publisher source before updating it`
      )
    const archivePath = join(staging, "source.zip")
    await writeFile(archivePath, archive)
    const extract = options.extract ?? extractEntry
    const bytes = await extract(archivePath, spec.vplEntry)
    if (sha256(bytes) !== spec.vplSha256)
      throw new Error(
        `${spec.code} VPL checksum differs from the pinned source`
      )
    const about = await extract(archivePath, spec.aboutEntry)
    if (sha256(about) !== spec.aboutSha256)
      throw new Error(
        `${spec.code} publisher notice checksum differs from the pinned source`
      )
    const converted = convertBibleVpl(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      { abbreviation: spec.code, name: spec.title }
    )
    validateBibleCorpus(converted, spec.bookVerseCounts)
    const json = JSON.stringify(converted) + "\n"
    if (sha256(json) !== spec.jsonSha256)
      throw new Error(
        `${spec.code} converted data differs from the reviewed conversion`
      )
    const stagedJson = join(staging, "source.json")
    await writeFile(stagedJson, json)
    await rename(stagedJson, destination)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
