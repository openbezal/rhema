import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"

const folders: string[] = []
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "rhema-bible-upgrade-"))
  folders.push(directory)
  await mkdir(join(directory, "sources"))
  return directory
}
afterEach(async () => { await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
function build(directory: string) { return execFileSync("bun", [resolve("data/build-bible-db.ts"), "--data-dir", directory], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }
function query(directory: string, sql: string) {
  const script = `import { Database } from "bun:sqlite"; const db = new Database(${JSON.stringify(join(directory, "rhema.db"))}, { readonly: true }); console.log(JSON.stringify(db.query(${JSON.stringify(sql)}).all())); db.close();`
  return JSON.parse(execFileSync("bun", ["-e", script], { encoding: "utf8" }))
}
const source = { translation: { abbreviation: "KJV" }, books: [{ book_number: 43, name: "John", chapters: [{ chapter: 3, verses: [{ verse: 16, text: "Synthetic fixture text" }] }] }] }

describe("Bible database upgrades", () => {
  it("uses canonical source book numbers instead of a partial array position", async () => {
    const directory = await fixture()
    await writeFile(join(directory, "sources", "KJV.json"), JSON.stringify(source))
    build(directory)
    expect(query(directory, "SELECT book_number, chapter, verse, text FROM verses")).toEqual([{ book_number: 43, chapter: 3, verse: 16, text: "Synthetic fixture text" }])
  })

  it.each([
    ["John", 43], ["I John", 62], ["II Peter", 61], ["III John", 64], ["Revelation of John", 66],
  ])("resolves legacy partial source %s by canonical name", async (name, bookNumber) => {
    const directory = await fixture()
    const legacy = { books: [{ name, chapters: source.books[0].chapters }] }
    await writeFile(join(directory, "sources", "KJV.json"), JSON.stringify(legacy))
    build(directory)
    expect(query(directory, "SELECT book_number FROM verses")).toEqual([{ book_number: bookNumber }])
  })

  it("rejects an unknown book without coordinates and preserves the working database", async () => {
    const directory = await fixture()
    const path = join(directory, "sources", "KJV.json")
    await writeFile(path, JSON.stringify(source))
    build(directory)
    const before = await readFile(join(directory, "rhema.db"))
    await writeFile(path, JSON.stringify({ books: [{ name: "Unknown", chapters: source.books[0].chapters }] }))
    expect(() => build(directory)).toThrow()
    expect(await readFile(join(directory, "rhema.db"))).toEqual(before)
  })

  it("preserves explicit empty omission rows in existing translation sources", async () => {
    const directory = await fixture()
    const omitted = structuredClone(source)
    omitted.books[0].chapters[0].verses.push({ verse: 17, text: "" })
    await writeFile(join(directory, "sources", "ESV.json"), JSON.stringify(omitted))
    build(directory)
    expect(query(directory, "SELECT verse, text FROM verses WHERE verse = 17")).toEqual([{ verse: 17, text: "" }])
  })

  it("releases prepared statements before replacing the database file", async () => {
    const directory = await fixture()
    await writeFile(join(directory, "sources", "KJV.json"), JSON.stringify(source))
    const url = pathToFileURL(resolve("data/build-bible-db.ts")).href
    const script = `import {Database} from "bun:sqlite";
      const prepare=Database.prototype.prepare; let held;
      Database.prototype.prepare=function(...args){held ??= prepare.call(this,"SELECT 1");return prepare.apply(this,args)};
      process.argv.push("--data-dir",${JSON.stringify(directory)});
      const {buildBibleDatabase}=await import(${JSON.stringify(url)});buildBibleDatabase();
      try {held.get();console.log("HANDLE:open")} catch(error) {console.log("HANDLE:"+error.message)}`
    const output = execFileSync("bun", ["-e", script], { encoding: "utf8", stdio: "pipe" })
    expect(output).toContain("HANDLE:Database has closed")
  })

  it("retains the working database when a rebuild input is invalid", async () => {
    const directory = await fixture()
    const path = join(directory, "sources", "KJV.json")
    await writeFile(path, JSON.stringify(source))
    build(directory)
    const before = await readFile(join(directory, "rhema.db"))
    await writeFile(path, "{invalid JSON")
    expect(() => build(directory)).toThrow()
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
    expect(digest(await readFile(join(directory, "rhema.db")))).toBe(digest(before))
    expect(query(directory, "SELECT COUNT(*) AS count FROM verses")).toEqual([{ count: 1 }])
  })
})
