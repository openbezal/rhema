import { afterEach, describe, expect, it } from "vitest"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, "..")
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8")
) as { scripts: { typecheck: string } }

function fixture(command = packageJson.scripts.typecheck) {
  const root = mkdtempSync(join(tmpdir(), "rhema-typecheck-"))
  roots.push(root)
  mkdirSync(join(root, "src"))
  symlinkSync(
    join(repositoryRoot, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  )
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { typecheck: command } })
  )
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] })
  )
  writeFileSync(
    join(root, "tsconfig.app.json"),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        types: [],
        skipLibCheck: true,
      },
      include: ["src"],
    })
  )
  writeFileSync(
    join(root, "src", "valid.ts"),
    "export const count: number = 1\n"
  )
  return root
}

function check(root: string) {
  return spawnSync("bun", ["run", "typecheck"], { cwd: root, encoding: "utf8" })
}

function verify(root: string) {
  return spawnSync(
    "bun",
    [join(repositoryRoot, "scripts/verify-typecheck.ts"), root],
    { encoding: "utf8" }
  )
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe("typecheck verification", () => {
  it("rejects a type error in a referenced application project", () => {
    const root = fixture()
    writeFileSync(
      join(root, "src", "invalid.ts"),
      'export const count: number = "wrong"\n'
    )
    const result = check(root)
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("TS2322")
  })

  it("accepts a valid referenced application project", () => {
    expect(check(fixture()).status).toBe(0)
  })

  it("verifies real checking and removes its temporary probe", () => {
    const root = fixture("tsc -b --noEmit")
    const result = verify(root)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(readdirSync(join(root, "src"))).toEqual(["valid.ts"])
  })

  it("rejects an empty solution check and removes its probe on failure", () => {
    const root = fixture("tsc --noEmit")
    const result = verify(root)
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain("did not reject")
    expect(readdirSync(join(root, "src"))).toEqual(["valid.ts"])
  })
})
