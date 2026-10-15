import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import pinned from "./yoruba-source.json"
import { convertYorubaVpl, YORUBA_VERSE_COUNTS } from "./convert-yoruba-vpl"
import { BIBLE_CANON } from "./lib/bible-canon"
import { ensureYorubaSource, sha256, type SourceFetcher } from "./lib/yoruba-source"

const folders: string[] = []
async function fixture() { const path = await mkdtemp(join(tmpdir(), "rhema-yoruba-source-")); folders.push(path); return path }
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const vpl = BIBLE_CANON.flatMap(([code], book) => Array.from({ length: YORUBA_VERSE_COUNTS[book] }, (_, index) => `${code} ${Math.floor(index / 176) + 1}:${index % 176 + 1} Synthetic test fixture.`)).join("\n")
const archive = new TextEncoder().encode("Synthetic archive boundary fixture")
const json = JSON.stringify(convertYorubaVpl(vpl)) + "\n"
const spec = { ...pinned, archiveSha256: sha256(archive), vplSha256: sha256(vpl), jsonSha256: sha256(json) }
const fetcher = vi.fn<SourceFetcher>(async () => new Response(archive))
const extract = vi.fn(async () => new TextEncoder().encode(vpl))

describe("pinned Yoruba source preparation", () => {
  it("validates a download and atomically installs the converted JSON", async () => {
    const directory = await fixture()
    await ensureYorubaSource(directory, { spec, fetcher, extract })
    expect(await readFile(join(directory, "OYCB.json"), "utf8")).toBe(json)
    expect(await readdir(directory)).toEqual(["OYCB.json"])
  })

  it("skips a verified source without network access", async () => {
    const directory = await fixture()
    await writeFile(join(directory, "OYCB.json"), json)
    const noFetch = vi.fn<SourceFetcher>()
    await ensureYorubaSource(directory, { spec, fetcher: noFetch })
    expect(noFetch).not.toHaveBeenCalled()
  })

  it.each(["archive", "vpl", "conversion"])("preserves old sources when the %s checksum fails", async (failure) => {
    const directory = await fixture()
    await writeFile(join(directory, "OYCB.json"), "old valid source")
    const changed = { ...spec, [failure === "archive" ? "archiveSha256" : failure === "vpl" ? "vplSha256" : "jsonSha256"]: "unreviewed" }
    await expect(ensureYorubaSource(directory, { spec: changed, fetcher, extract })).rejects.toThrow(/checksum|differs/)
    expect(await readFile(join(directory, "OYCB.json"), "utf8")).toBe("old valid source")
    expect(await readdir(directory)).toEqual(["OYCB.json"])
  })

  it("includes the exact source notice retained from the pinned archive", async () => {
    expect(sha256(await readFile(new URL("./licenses/OYCB-about.html", import.meta.url)))).toBe(pinned.aboutSha256)
    const notice = await readFile(new URL("./licenses/OYCB-NOTICE.txt", import.meta.url), "utf8")
    expect(notice).toContain("Copyright © 2009, 2017 by Biblica, Inc.")
    expect(notice).toContain("https://creativecommons.org/licenses/by-sa/4.0/")
  })
})
