import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"
import toolchain from "../embedding-toolchain.json"
import { PROJECT_ROOT } from "./python-env"

export const EMBEDDING_REQUIREMENTS = toolchain.requirements
export const EMBEDDING_MINIMUM_PYTHON = toolchain.minimumPython as [
  number,
  number,
  number,
]
export type EmbeddingRunner = (
  command: string[],
  capture?: boolean
) => Promise<string>

export function createEmbeddingPlan(
  root: string,
  source = `<snapshot:${toolchain.revision}>`,
  outputRoot = join(root, "models")
) {
  const bin = (name: string) =>
    process.platform === "win32"
      ? join(root, ".venv", "Scripts", `${name}.exe`)
      : join(root, ".venv", "bin", name)
  const fp32 = join(outputRoot, "qwen3-embedding-0.6b")
  const int8 = join(outputRoot, "qwen3-embedding-0.6b-int8")
  return {
    ...toolchain,
    snapshot: [
      bin("python"),
      join(root, "data/lib/embedding_assets.py"),
      "snapshot",
      "--model-id",
      toolchain.modelId,
      "--revision",
      toolchain.revision,
    ],
    export: [
      bin("optimum-cli"),
      "export",
      "onnx",
      "--model",
      source,
      "--task",
      "feature-extraction",
      "--library-name",
      "transformers",
      "--dtype",
      "fp32",
      "--opset",
      "18",
      "--batch_size",
      "1",
      "--sequence_length",
      "128",
      fp32,
    ],
    quantize: [
      bin("optimum-cli"),
      "onnxruntime",
      "quantize",
      "--onnx_model",
      fp32,
      "--arm64",
      "-o",
      int8,
    ],
  }
}

export const runEmbeddingCommand: EmbeddingRunner = async (
  command,
  capture = false
) => {
  const process = Bun.spawn(command, {
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
    cwd: PROJECT_ROOT,
  })
  const output = capture ? await new Response(process.stdout).text() : ""
  const code = await process.exited
  if (code !== 0)
    throw new Error(`Embedding command failed (${code}): ${command.join(" ")}`)
  return output
}

interface AssetReport {
  valid: boolean
  fingerprint?: string
  reason?: string
}

async function inspect(
  root: string,
  directory: string,
  filename: string,
  run: EmbeddingRunner
): Promise<AssetReport> {
  const plan = createEmbeddingPlan(root)
  const output = await run(
    [
      plan.snapshot[0],
      plan.snapshot[1],
      "inspect",
      "--directory",
      directory,
      "--filename",
      filename,
    ],
    true
  )
  const report: unknown = JSON.parse(output)
  if (
    !report ||
    typeof report !== "object" ||
    !("valid" in report) ||
    typeof report.valid !== "boolean"
  ) {
    throw new Error("Invalid embedding asset inspection response")
  }
  const value = report as AssetReport
  if (
    value.valid &&
    (typeof value.fingerprint !== "string" || !value.fingerprint)
  )
    throw new Error("Missing embedding fingerprint")
  return value
}

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return null
  }
}

/** Build in a sibling staging directory; a failed export/quantize retains the old assets. */
export async function prepareEmbeddingModels(
  {
    root = PROJECT_ROOT,
    force = false,
  }: { root?: string; force?: boolean } = {},
  run: EmbeddingRunner = runEmbeddingCommand
): Promise<{ changed: boolean; fingerprint: string }> {
  const models = join(root, "models")
  await mkdir(models, { recursive: true })
  const lock = join(models, ".rhema-embedding.lock")
  try {
    await mkdir(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Embedding preparation already running. If an earlier process crashed, inspect ${lock} before removing its stale lock.`
      )
    }
    throw error
  }
  try {
    return await prepareUnlockedModels(root, force, run)
  } finally {
    await rmdir(lock)
  }
}

async function prepareUnlockedModels(
  root: string,
  force: boolean,
  run: EmbeddingRunner
): Promise<{ changed: boolean; fingerprint: string }> {
  const models = join(root, "models")
  const receiptPath = join(models, ".rhema-embedding-toolchain.json")
  const names = ["qwen3-embedding-0.6b", "qwen3-embedding-0.6b-int8"]
  const filenames = ["model.onnx", "model_quantized.onnx"]
  const checkPair = async (directory: string) => {
    const reports = []
    for (let index = 0; index < names.length; index++) {
      reports.push(
        await inspect(
          root,
          join(directory, names[index]),
          filenames[index],
          run
        )
      )
    }
    return reports
  }
  const receipt = (reports: AssetReport[]) => ({
    toolchain,
    assets: reports.map((report) => report.fingerprint),
  })
  if (!force && existsSync(receiptPath)) {
    const reports = await checkPair(models)
    const expected = receipt(reports)
    if (
      reports.every((report) => report.valid) &&
      digest(await readJson(receiptPath)) === digest(expected)
    ) {
      console.log(
        "  Verified embedding models and pinned toolchain receipt; skipping export."
      )
      return { changed: false, fingerprint: digest(expected) }
    }
  }

  await mkdir(models, { recursive: true })
  const staging = await mkdtemp(join(models, ".rhema-embedding-"))
  let removeStaging = true
  try {
    const initial = createEmbeddingPlan(root)
    const downloaded: unknown = JSON.parse(await run(initial.snapshot, true))
    if (
      !downloaded ||
      typeof downloaded !== "object" ||
      !("path" in downloaded) ||
      typeof downloaded.path !== "string" ||
      !downloaded.path
    ) {
      throw new Error("Pinned model snapshot returned no local directory")
    }
    const plan = createEmbeddingPlan(root, downloaded.path, staging)
    await run(plan.export)
    const exported = await inspect(
      root,
      join(staging, names[0]),
      filenames[0],
      run
    )
    if (!exported.valid)
      throw new Error(`Export is incomplete: ${exported.reason}`)
    await run(plan.quantize)
    const reports = await checkPair(staging)
    const invalid = reports.find((report) => !report.valid)
    if (invalid)
      throw new Error(`Embedding output is incomplete: ${invalid.reason}`)
    const nextReceipt = receipt(reports)
    await writeFile(
      join(staging, "receipt.json"),
      JSON.stringify(nextReceipt, null, 2) + "\n"
    )

    const installed: string[] = []
    const backedUp: string[] = []
    const entries = [...names, ".rhema-embedding-toolchain.json"]
    try {
      for (const name of entries) {
        const destination = join(models, name)
        if (existsSync(destination)) {
          await rename(destination, join(staging, `previous-${name}`))
          backedUp.push(name)
        }
        await rename(
          join(staging, name === entries[2] ? "receipt.json" : name),
          destination
        )
        installed.push(name)
      }
    } catch (error) {
      try {
        for (const name of installed.reverse())
          await rm(join(models, name), { recursive: true, force: true })
        for (const name of backedUp.reverse())
          await rename(join(staging, `previous-${name}`), join(models, name))
      } catch (rollbackError) {
        removeStaging = false
        throw new AggregateError(
          [error, rollbackError],
          `Model publication/rollback failed; backups retained in ${staging}`
        )
      }
      throw error
    }
    return { changed: true, fingerprint: digest(nextReceipt) }
  } finally {
    if (removeStaging) await rm(staging, { recursive: true, force: true })
  }
}

async function fileHash(path: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

async function indexReceipt(root: string, modelFingerprint: string) {
  const directory = join(root, "embeddings")
  return {
    modelFingerprint,
    verses: await fileHash(join(root, "data/verses-for-embedding.json")),
    embeddings: await fileHash(join(directory, "kjv-qwen3-0.6b.bin")),
    ids: await fileHash(join(directory, "kjv-qwen3-0.6b-ids.bin")),
  }
}

export async function isEmbeddingIndexCurrent(
  root: string,
  modelFingerprint: string
): Promise<boolean> {
  try {
    return (
      digest(await indexReceipt(root, modelFingerprint)) ===
      digest(
        await readJson(join(root, "embeddings/kjv-qwen3-0.6b.toolchain.json"))
      )
    )
  } catch {
    return false
  }
}

export async function recordEmbeddingIndex(
  root: string,
  modelFingerprint: string
): Promise<void> {
  const receipt = await indexReceipt(root, modelFingerprint)
  await writeFile(
    join(root, "embeddings/kjv-qwen3-0.6b.toolchain.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  )
}
