import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import {
  ensureLocalBibleSource,
  LOCAL_BIBLE_SOURCES,
  sha256,
} from "./lib/local-bible-source"
import { convertBibleVpl } from "./convert-bible-vpl"
import { readFileSync } from "node:fs"
import { createBibleBuildManifest } from "./lib/bible-build-manifest"
import { BIBLE_CANON } from "./lib/bible-canon"
const folders: string[] = []
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})
const archive = new TextEncoder().encode("synthetic archive")
const vpl = BIBLE_CANON.flatMap(([code, , chapters]) =>
  Array.from({ length: chapters }, (_, i) => `${code} ${i + 1}:1 Ƙasa ụwa.`)
).join("\n")
const about = new TextEncoder().encode("Synthetic license fixture")
for (const pinned of LOCAL_BIBLE_SOURCES) {
  const json =
    JSON.stringify(
      convertBibleVpl(vpl, { abbreviation: pinned.code, name: pinned.title })
    ) + "\n"
  const spec = {
    ...pinned,
    archiveSha256: sha256(archive),
    vplSha256: sha256(vpl),
    aboutSha256: sha256(about),
    jsonSha256: sha256(json),
    bookVerseCounts: BIBLE_CANON.map(([, , n]) => n),
  }
  const fetcher = vi.fn(async () => new Response(archive))
  const extract = vi.fn(async (_path: string, entry: string) =>
    entry === spec.vplEntry ? new TextEncoder().encode(vpl) : about
  )
  it(`${pinned.code}: validates all pinned bytes and installs once`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhema-local-source-"))
    folders.push(directory)
    await ensureLocalBibleSource(directory, spec, { fetcher, extract })
    expect(await readFile(join(directory, `${spec.code}.json`), "utf8")).toBe(
      json
    )
    expect(await readdir(directory)).toEqual([`${spec.code}.json`])
    const noFetch = vi.fn()
    await ensureLocalBibleSource(directory, spec, { fetcher: noFetch })
    expect(noFetch).not.toHaveBeenCalled()
  })
  it.each(["archiveSha256", "vplSha256", "aboutSha256", "jsonSha256"] as const)(
    `${pinned.code}: preserves old data after %s failure`,
    async (key) => {
      const directory = await mkdtemp(join(tmpdir(), "rhema-local-source-"))
      folders.push(directory)
      const destination = join(directory, `${spec.code}.json`)
      await writeFile(destination, "previous working data")
      await expect(
        ensureLocalBibleSource(
          directory,
          { ...spec, [key]: "unreviewed" },
          { fetcher, extract }
        )
      ).rejects.toThrow()
      expect(await readFile(destination, "utf8")).toBe("previous working data")
      expect(await readdir(directory)).toEqual([`${spec.code}.json`])
    }
  )
  it(`${pinned.code}: packages the exact publisher notice and official title`, async () => {
    expect(
      sha256(
        await readFile(
          new URL(`./licenses/${pinned.code}-about.html`, import.meta.url)
        )
      )
    ).toBe(pinned.aboutSha256)
    const notice = await readFile(
      new URL(`./licenses/${pinned.code}-NOTICE.txt`, import.meta.url),
      "utf8"
    )
    expect(notice).toContain(pinned.nativeTitle)
    expect(notice).toContain("https://creativecommons.org/licenses/by-sa/4.0/")
    expect(pinned.title).not.toContain("King James")
  })
}

it("includes every edition notice and source provenance in packaging and freshness", async () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
  for (const spec of LOCAL_BIBLE_SOURCES)
    for (const suffix of ["NOTICE.txt", "about.html"])
      expect(
        config.bundle.resources[`../data/licenses/${spec.code}-${suffix}`]
      ).toBe(`licenses/${spec.code}-${suffix}`)
  expect(config.bundle.resources["../data/local-bible-sources.json"]).toBe(
    "licenses/local-bible-sources.json"
  )
  const directory = await mkdtemp(join(tmpdir(), "rhema-local-manifest-"))
  folders.push(directory)
  expect(
    createBibleBuildManifest(directory, []).localSourceSpecificationSha256
  ).toBe(sha256(readFileSync("data/local-bible-sources.json")))
})
