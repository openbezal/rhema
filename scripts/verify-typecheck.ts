import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(process.argv[2] ?? process.cwd())
const probeDir = mkdtempSync(join(root, "src", "typecheck-probe-"))

try {
  const probePath = join(probeDir, "invalid.ts")
  writeFileSync(
    probePath,
    'export const typecheckProbe: number = "must be rejected"\n'
  )
  const result = spawnSync("bun", ["run", "typecheck"], {
    cwd: root,
    encoding: "utf8",
  })
  if (result.error) throw result.error
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  if (
    result.status === 0 ||
    !output.includes("TS2322") ||
    !output.includes("invalid.ts")
  ) {
    throw new Error(
      `Typecheck did not reject the seeded application error.\n${output}`
    )
  }
  console.log("Typecheck rejects errors in the referenced application project.")
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  rmSync(probeDir, { recursive: true, force: true })
}
