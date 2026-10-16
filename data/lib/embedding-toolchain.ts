import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rmdir,
  rm,
  stat,
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

/** One lease covers either model-only preparation or the complete model/index lifecycle. */
async function withEmbeddingLock<T>(
  root: string,
  work: () => Promise<T>
): Promise<T> {
  const models = join(root, "models")
  await mkdir(models, { recursive: true })
  const lock = join(models, ".rhema-embedding.lock")
  try {
    await mkdir(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Embedding preparation already running. If an earlier process crashed, inspect ${lock} before removing its stale lock.`
      )
    throw error
  }
  try {
    return await work()
  } finally {
    await rmdir(lock)
  }
}

/** Publish only prepared files; retain old artifacts on failure and backups if rollback fails. */
async function prepareStagedFiles<T>(
  parent: string,
  prefix: string,
  prepare: (staging: string) => Promise<{ files: string[]; result: T }>
): Promise<T> {
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, prefix))
  let cleanup = true
  try {
    const { files, result } = await prepare(staging)
    const installed: string[] = [],
      backedUp: string[] = []
    try {
      for (const name of files) {
        if (existsSync(join(parent, name))) {
          await rename(join(parent, name), join(staging, `previous-${name}`))
          backedUp.push(name)
        }
        await rename(join(staging, name), join(parent, name))
        installed.push(name)
      }
    } catch (error) {
      try {
        for (const name of installed.reverse())
          await rm(join(parent, name), { recursive: true, force: true })
        for (const name of backedUp.reverse())
          await rename(join(staging, `previous-${name}`), join(parent, name))
      } catch (rollbackError) {
        cleanup = false
        throw new AggregateError(
          [error, rollbackError],
          `Embedding publication/rollback failed; backups retained in ${staging}`
        )
      }
      throw error
    }
    return result
  } finally {
    if (cleanup) await rm(staging, { recursive: true, force: true })
  }
}

export async function prepareEmbeddingModels(
  {
    root = PROJECT_ROOT,
    force = false,
  }: { root?: string; force?: boolean } = {},
  run: EmbeddingRunner = runEmbeddingCommand
): Promise<{ changed: boolean; fingerprint: string }> {
  return withEmbeddingLock(root, () => prepareUnlockedModels(root, force, run))
}

async function prepareUnlockedModels(
  root: string,
  force: boolean,
  run: EmbeddingRunner
): Promise<{ changed: boolean; fingerprint: string }> {
  const models = join(root, "models")
  const receiptName = ".rhema-embedding-toolchain.json"
  const names = ["qwen3-embedding-0.6b", "qwen3-embedding-0.6b-int8"]
  const filenames = ["model.onnx", "model_quantized.onnx"]
  const checkPair = async (directory: string) => {
    const reports: AssetReport[] = []
    for (let index = 0; index < names.length; index++)
      reports.push(
        await inspect(
          root,
          join(directory, names[index]),
          filenames[index],
          run
        )
      )
    return reports
  }
  const receipt = (reports: AssetReport[]) => ({
    toolchain,
    assets: reports.map((report) => report.fingerprint),
  })
  if (!force && existsSync(join(models, receiptName))) {
    const reports = await checkPair(models)
    const expected = receipt(reports)
    if (
      reports.every((report) => report.valid) &&
      digest(await readJson(join(models, receiptName))) === digest(expected)
    ) {
      console.log(
        "  Verified embedding models and pinned toolchain receipt; skipping export."
      )
      return { changed: false, fingerprint: digest(expected) }
    }
  }
  return prepareStagedFiles(models, ".rhema-embedding-", async (staging) => {
    const initial = createEmbeddingPlan(root)
    const downloaded: unknown = JSON.parse(await run(initial.snapshot, true))
    if (
      !downloaded ||
      typeof downloaded !== "object" ||
      !("path" in downloaded) ||
      typeof downloaded.path !== "string" ||
      !downloaded.path
    )
      throw new Error("Pinned model snapshot returned no local directory")
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
    const next = receipt(reports)
    await writeFile(
      join(staging, receiptName),
      JSON.stringify(next, null, 2) + "\n"
    )
    return {
      files: [...names, receiptName],
      result: { changed: true, fingerprint: digest(next) },
    }
  })
}

async function fileHash(path: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

const INDEX_FILE = "kjv-qwen3-0.6b.bin"
const IDS_FILE = "kjv-qwen3-0.6b-ids.bin"
const INDEX_RECEIPT = "kjv-qwen3-0.6b.toolchain.json"
const INDEX_META = "kjv-qwen3-0.6b.meta.json"
interface SourceVerse {
  id: number
  text: string
}
function sourceVerses(bytes: Buffer): SourceVerse[] {
  const source: unknown = JSON.parse(bytes.toString("utf8"))
  if (
    !Array.isArray(source) ||
    source.length === 0 ||
    !source.every(
      (verse) =>
        verse &&
        Number.isSafeInteger(verse.id) &&
        verse.id > 0 &&
        typeof verse.text === "string" &&
        verse.text.trim()
    )
  )
    throw new Error("Embedding source must contain real nonempty verse rows")
  const entries = source as SourceVerse[]
  if (new Set(entries.map((verse) => verse.id)).size !== entries.length)
    throw new Error("Embedding source has duplicate IDs")
  return entries
}

async function indexReceipt(
  directory: string,
  modelFingerprint: string,
  sourcePath: string
) {
  const source = await readFile(sourcePath)
  const entries = sourceVerses(source)
  const vectorPath = join(directory, INDEX_FILE),
    idsPath = join(directory, IDS_FILE)
  const ids = await readFile(idsPath)
  if (
    (await stat(vectorPath)).size !==
      entries.length * toolchain.contract.dimensions * 4 ||
    ids.length !== entries.length * 8
  )
    throw new Error(
      "Embedding index size does not match source verse count/dimension"
    )
  if (
    !entries.every(
      (entry, index) => ids.readBigInt64LE(index * 8) === BigInt(entry.id)
    )
  )
    throw new Error("Embedding IDs do not match the source rows")
  return {
    modelFingerprint,
    verses: createHash("sha256").update(source).digest("hex"),
    verseCount: entries.length,
    dimension: toolchain.contract.dimensions,
    embeddings: await fileHash(vectorPath),
    ids: createHash("sha256").update(ids).digest("hex"),
  }
}

export async function isEmbeddingIndexCurrent(
  root: string,
  modelFingerprint: string,
  dataDir = join(root, "data")
): Promise<boolean> {
  try {
    return (
      digest(
        await indexReceipt(
          join(root, "embeddings"),
          modelFingerprint,
          join(dataDir, "verses-for-embedding.json")
        )
      ) === digest(await readJson(join(root, "embeddings", INDEX_RECEIPT)))
    )
  } catch {
    return false
  }
}

/** Low-level receipt helper for already completed developer indexes; full setup uses staging under its lease. */
export async function recordEmbeddingIndex(
  root: string,
  modelFingerprint: string,
  dataDir = join(root, "data")
): Promise<void> {
  const receipt = await indexReceipt(
    join(root, "embeddings"),
    modelFingerprint,
    join(dataDir, "verses-for-embedding.json")
  )
  await writeFile(
    join(root, "embeddings", INDEX_RECEIPT),
    JSON.stringify(receipt, null, 2) + "\n"
  )
}

/** Refresh source and generate a matching native index under the same lease as model preparation. */
export async function prepareEmbeddingAssets(
  {
    root = PROJECT_ROOT,
    dataDir = join(root, "data"),
    force = false,
  }: { root?: string; dataDir?: string; force?: boolean } = {},
  run: EmbeddingRunner = runEmbeddingCommand,
  prepareSource?: () => Promise<void>
): Promise<{ changed: boolean; fingerprint: string; indexChanged: boolean }> {
  return withEmbeddingLock(root, async () => {
    await prepareSource?.()
    const models = await prepareUnlockedModels(root, force, run)
    await run([
      "bun",
      "run",
      join(root, "data/compute-embeddings.ts"),
      "--data-dir",
      dataDir,
    ])
    if (
      !force &&
      (await isEmbeddingIndexCurrent(root, models.fingerprint, dataDir))
    )
      return { ...models, indexChanged: false }
    return prepareStagedFiles(
      join(root, "embeddings"),
      ".rhema-index-",
      async (staging) => {
        const sourcePath = join(dataDir, "verses-for-embedding.json")
        const source = await readFile(sourcePath)
        sourceVerses(source)
        const snapshot = join(staging, "verses.json")
        await writeFile(snapshot, source)
        await run([
          "cargo",
          "run",
          "--manifest-path",
          join(root, "src-tauri/Cargo.toml"),
          "--locked",
          "-p",
          "rhema-detection",
          "--features",
          "precompute-bin",
          "--release",
          "--bin",
          "precompute",
          "--",
          "--model",
          join(root, "models/qwen3-embedding-0.6b-int8/model_quantized.onnx"),
          "--tokenizer",
          join(root, "models/qwen3-embedding-0.6b/tokenizer.json"),
          "--verses",
          snapshot,
          "--output-embeddings",
          join(staging, INDEX_FILE),
          "--output-ids",
          join(staging, IDS_FILE),
        ])
        const receipt = await indexReceipt(
          staging,
          models.fingerprint,
          snapshot
        )
        if ((await fileHash(sourcePath)) !== receipt.verses)
          throw new Error(
            "Embedding source changed during generation; previous index retained"
          )
        await writeFile(
          join(staging, INDEX_META),
          JSON.stringify(
            {
              model_file: "model_quantized.onnx",
              prompt_prefix: toolchain.contract.prefix,
              pooling: toolchain.contract.pooling,
              max_tokens: toolchain.contract.maxTokens,
              verse_count: receipt.verseCount,
              model_fingerprint: models.fingerprint,
              source_sha256: receipt.verses,
              generated_by: "Rhema pinned native precompute",
            },
            null,
            2
          ) + "\n"
        )
        await writeFile(
          join(staging, INDEX_RECEIPT),
          JSON.stringify(receipt, null, 2) + "\n"
        )
        const files = [INDEX_FILE, IDS_FILE, INDEX_META, INDEX_RECEIPT]
        return { files, result: { ...models, indexChanged: true } }
      }
    )
  })
}
