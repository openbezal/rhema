import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const folders: string[] = []
const source = (text: string) => ({ translation: { abbreviation: "KJV" }, books: [{ book_number: 43, name: "John", chapters: [{ chapter: 3, verses: [{ verse: 16, text }] }] }] })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "rhema-setup-freshness-")); folders.push(directory)
  await mkdir(join(directory, "sources"))
  await writeFile(join(directory, "sources", "KJV.json"), JSON.stringify(source("Old synthetic text")))
  execFileSync("bun", [resolve("data/build-bible-db.ts"), "--data-dir", directory], { stdio: "pipe" })
  return directory
}
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
function ensure(directory: string, downloadBody: string, force = false) {
  const url = pathToFileURL(resolve("data/lib/bible-assets.ts")).href
  const script = `import {ensureBibleAssets} from ${JSON.stringify(url)}; import {writeFile} from "node:fs/promises"; const directory=${JSON.stringify(directory)}; const rebuilt=await ensureBibleAssets(directory,{force:${force},download:async()=>{${downloadBody}}}); console.log("RESULT:"+JSON.stringify({rebuilt}));`
  const stdout = execFileSync("bun", ["-e", script], { encoding: "utf8", stdio: "pipe" })
  return JSON.parse(stdout.split("\n").find((line) => line.startsWith("RESULT:"))!.slice(7))
}
const hash = async (directory: string) => createHash("sha256").update(await readFile(join(directory, "rhema.db"))).digest("hex")

describe("shared Bible setup freshness", () => {
  it("downloads a newly required language even when an old DB exists", async () => {
    const directory = await fixture()
    const added = JSON.stringify(source("New language synthetic fixture"))
    expect(ensure(directory, `await writeFile(directory+"/sources/OYCB.json",${JSON.stringify(added)});`).rebuilt).toBe(true)
    const query = `import {Database} from "bun:sqlite";const db=new Database(${JSON.stringify(join(directory, "rhema.db"))},{readonly:true});console.log(JSON.stringify(db.query("SELECT abbreviation, language FROM translations WHERE abbreviation = ?").get("OYCB")));db.close();`
    expect(JSON.parse(execFileSync("bun", ["-e", query], { encoding: "utf8", stdio: "pipe" }))).toEqual({ abbreviation: "OYCB", language: "yo" })
  })

  it("rebuilds after source content changes and then skips an identical rerun", async () => {
    const directory = await fixture()
    await writeFile(join(directory, "sources", "KJV.json"), JSON.stringify(source("Updated synthetic text")))
    expect(ensure(directory, "").rebuilt).toBe(true)
    const before = await hash(directory)
    expect(ensure(directory, "").rebuilt).toBe(false)
    expect(await hash(directory)).toBe(before)
    expect(ensure(directory, "", true).rebuilt).toBe(true)
  })

  it("retains the working database when the download phase fails", async () => {
    const directory = await fixture()
    const before = await hash(directory)
    expect(() => ensure(directory, 'throw new Error("Download failed");')).toThrow()
    expect(await hash(directory)).toBe(before)
  })
})
