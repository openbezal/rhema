/**
 * Shared Python environment management utilities.
 *
 * Provides functions to find Python, create/manage a .venv, and install pip
 * packages. Used by download-model.ts and prepare-embeddings.ts so every
 * Python-dependent script shares a single virtual-environment setup path.
 */

import { join } from "node:path"
import { existsSync } from "node:fs"

export const PROJECT_ROOT = join(import.meta.dir, "..", "..")
export const VENV_DIR = join(PROJECT_ROOT, ".venv")
export const MIN_PYTHON_VERSION: [number, number, number] = [3, 9, 0]

export function getVenvBin(name: string): string {
  if (process.platform === "win32") {
    return join(VENV_DIR, "Scripts", `${name}.exe`)
  }
  return join(VENV_DIR, "bin", name)
}

export async function findPython(): Promise<string> {
  for (const candidate of [
    "python3.12",
    "python3.11",
    "python3.10",
    "python3",
    "python",
  ]) {
    try {
      const proc = Bun.spawn([candidate, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      if (exitCode === 0 && output.includes("Python")) {
        return candidate
      }
    } catch {
      // Binary not found, try next candidate
    }
  }

  console.error("\n❌ Python not found.")
  console.error(
    "   Please install Python >= 3.9.0 and ensure it is in your PATH."
  )
  process.exit(1)
}

export function parsePythonVersion(
  output: string
): [number, number, number] {
  const match = output.trim().match(/Python\s+(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    throw new Error(`Could not parse Python version from: ${output.trim()}`)
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isVersionSufficient(
  version: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i] > MIN_PYTHON_VERSION[i]) return true
    if (version[i] < MIN_PYTHON_VERSION[i]) return false
  }
  return true
}

export async function ensureVenv(pythonCmd: string): Promise<void> {
  const venvPython =
    process.platform === "win32"
      ? getVenvBin("python")
      : getVenvBin("python3")

  if (existsSync(venvPython)) {
    console.log(`  ⏭ Virtual environment already exists at ${VENV_DIR}`)
    return
  }

  console.log(`  Creating virtual environment at ${VENV_DIR}...`)
  const proc = Bun.spawn([pythonCmd, "-m", "venv", VENV_DIR], {
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error("\n❌ Failed to create virtual environment.")
    process.exit(1)
  }
  console.log("  ✓ Virtual environment created")
}

export async function installPipDeps(packages: string[]): Promise<void> {
  const pip = getVenvBin("pip")
  console.log(`  Installing ${packages.join(", ")}...`)
  const proc = Bun.spawn([pip, "install", ...packages], {
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    console.error("\n❌ Failed to install dependencies.")
    process.exit(1)
  }
  console.log("  ✓ Dependencies installed")
}

/**
 * Full Python environment setup: find Python, verify version, create venv,
 * install packages. Returns the path to the venv Python binary.
 */
export async function ensurePythonEnv(
  packages: string[]
): Promise<string> {
  console.log("\n🐍 Setting up Python environment...\n")

  const pythonCmd = await findPython()

  const versionProc = Bun.spawn([pythonCmd, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const versionOutput = await new Response(versionProc.stdout).text()
  await versionProc.exited
  const version = parsePythonVersion(versionOutput)
  console.log(`  Found ${pythonCmd} version ${version.join(".")}`)

  if (!isVersionSufficient(version)) {
    console.error(
      `\n❌ Python >= ${MIN_PYTHON_VERSION.join(".")} is required, found ${version.join(".")}`
    )
    process.exit(1)
  }

  await ensureVenv(pythonCmd)
  await installPipDeps(packages)

  return getVenvBin(process.platform === "win32" ? "python" : "python3")
}
