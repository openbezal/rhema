import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createEmbeddingPlan,
  prepareEmbeddingModels,
  isEmbeddingIndexCurrent,
  recordEmbeddingIndex,
  type EmbeddingRunner,
} from "./lib/embedding-toolchain"
import {
  findPython,
  isVersionSufficient,
  ensurePythonEnv,
  getVenvBin,
} from "./lib/python-env"

const folders: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true }))
  )
})

describe("compatible embedding commands", () => {
  it("pins export to token output and never passes an export-only option to quantize", () => {
    const plan = createEmbeddingPlan("/project with spaces")
    expect(plan.export).toEqual([
      expect.stringContaining("optimum-cli"),
      "export",
      "onnx",
      "--model",
      expect.any(String),
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
      expect.any(String),
    ])
    expect(plan.quantize).toEqual([
      expect.stringContaining("optimum-cli"),
      "onnxruntime",
      "quantize",
      "--onnx_model",
      expect.any(String),
      "--arm64",
      "-o",
      expect.any(String),
    ])
    expect(plan.snapshot).toContain("c54f2e6e80b2d7b7de06f51cec4959f6b3e03418")
    expect(
      plan.requirements.every((requirement) =>
        /^[\w[\],.-]+==\d+\.\d+\.\d+$/.test(requirement)
      )
    ).toBe(true)
    expect(plan.minimumPython).toEqual([3, 11, 0])
    expect(plan.contract).toMatchObject({
      pooling: "masked-mean",
      maxTokens: 128,
      prefix: "",
      dimensions: 1024,
    })
  })

  it.each(["data/download-model.ts", "data/prepare-embeddings.ts"])(
    "exposes the shared plan without downloading or initializing Python: %s",
    (script) => {
      const output = execFileSync("bun", [resolve(script), "--plan"], {
        encoding: "utf8",
        timeout: 5000,
      })
      const plan = JSON.parse(output)
      expect(plan).toEqual(createEmbeddingPlan(resolve(".")))
      expect(plan.quantize).not.toContain("--library-name")
    }
  )
})

describe("Python compatibility", () => {
  it("keeps the general default while allowing an embedding-specific minimum", () => {
    expect(isVersionSufficient([3, 9, 0])).toBe(true)
    expect(isVersionSufficient([3, 10, 99], [3, 11, 0])).toBe(false)
    expect(isVersionSufficient([3, 11, 0], [3, 11, 0])).toBe(true)
    expect(isVersionSufficient([3, 14, 7], [3, 11, 0])).toBe(true)
  })

  it("continues past an installed but too-old interpreter", async () => {
    const spawn = vi.fn(([candidate]: string[]) => ({
      stdout: new Blob([
        candidate === "python3.12" ? "Python 3.10.9" : "Python 3.14.7",
      ]).stream(),
      stderr: new Blob([]).stream(),
      exited: Promise.resolve(0),
    }))
    vi.stubGlobal("Bun", { spawn })
    expect(await findPython([3, 11, 0])).toBe("python3.11")
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it("validates an existing venv before installing dependencies", async () => {
    // Test the same existing-venv branch on all runners without a real Python installation.
    const spawn = vi.fn(() => ({
      stdout: new Blob(["Python 3.10.9"]).stream(),
      stderr: new Blob([]).stream(),
      exited: Promise.resolve(0),
    }))
    vi.stubGlobal("Bun", { spawn })
    await expect(
      ensurePythonEnv(["numpy==2.4.4"], [3, 11, 0], () => true)
    ).rejects.toThrow("3.11.0")
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      [
        getVenvBin(process.platform === "win32" ? "python" : "python3"),
        "--version",
      ],
      expect.any(Object)
    )
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "rhema-model-tooling-"))
  folders.push(root)
  const calls: string[][] = []
  let fail = ""
  const runner: EmbeddingRunner = async (command) => {
    calls.push(command)
    if (command.includes("snapshot"))
      return JSON.stringify({ path: "/cached/pinned source" })
    if (command.includes("inspect")) {
      const directory = command[command.indexOf("--directory") + 1]
      const name = command[command.indexOf("--filename") + 1]
      const file = join(directory, name)
      const content = existsSync(file) ? await readFile(file, "utf8") : ""
      return JSON.stringify({
        valid: content.startsWith("complete"),
        fingerprint: content,
        reason: "synthetic missing external data",
      })
    }
    const isExport = command.includes("export")
    if ((isExport ? "export" : "quantize") === fail)
      throw new Error(`${fail} failed`)
    const destination = isExport
      ? command.at(-1)!
      : command[command.indexOf("-o") + 1]
    await mkdir(destination, { recursive: true })
    await writeFile(
      join(destination, isExport ? "model.onnx" : "model_quantized.onnx"),
      `complete-${isExport ? "fp32" : "int8"}`
    )
    return ""
  }
  return {
    root,
    calls,
    runner,
    setFailure: (value: string) => {
      fail = value
    },
  }
}

describe("model preparation and provenance", () => {
  it("refuses a second model build while the first owns the destination", async () => {
    const { root, runner } = await fixture()
    let enter!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = prepareEmbeddingModels({ root }, async (command, capture) => {
      if (command.includes("snapshot")) {
        enter()
        await released
      }
      return runner(command, capture)
    })
    await entered
    try {
      await expect(prepareEmbeddingModels({ root }, runner)).rejects.toThrow(
        "already running"
      )
    } finally {
      release()
      await first
    }
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(false)
  })
  it("requires the index to match both model provenance and its own binary contents", async () => {
    const { root } = await fixture()
    await mkdir(join(root, "embeddings"))
    await mkdir(join(root, "data"))
    await writeFile(
      join(root, "data/verses-for-embedding.json"),
      "synthetic source"
    )
    await writeFile(
      join(root, "embeddings/kjv-qwen3-0.6b.bin"),
      "synthetic vectors"
    )
    await writeFile(
      join(root, "embeddings/kjv-qwen3-0.6b-ids.bin"),
      "synthetic ids"
    )
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(false)
    await recordEmbeddingIndex(root, "model-A")
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(true)
    expect(await isEmbeddingIndexCurrent(root, "model-B")).toBe(false)
    await writeFile(
      join(root, "data/verses-for-embedding.json"),
      "changed source"
    )
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(false)
    await recordEmbeddingIndex(root, "model-A")
    await writeFile(
      join(root, "embeddings/kjv-qwen3-0.6b.bin"),
      "other vectors"
    )
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(false)
  })
  it("exports and quantizes once, then skips only a verified receipt and unchanged assets", async () => {
    const { root, runner, calls } = await fixture()
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(true)
    calls.length = 0
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(false)
    expect(calls.every((command) => command.includes("inspect"))).toBe(true)
    await writeFile(
      join(root, "models/qwen3-embedding-0.6b/model.onnx"),
      "header-with-missing-external-data"
    )
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(true)
  })

  it("rebuilds when a valid graph changes or the toolchain receipt is missing", async () => {
    const { root, runner } = await fixture()
    await prepareEmbeddingModels({ root }, runner)
    await writeFile(
      join(root, "models/qwen3-embedding-0.6b-int8/model_quantized.onnx"),
      "complete-other-model"
    )
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(true)
    await rm(join(root, "models/.rhema-embedding-toolchain.json"))
    expect((await prepareEmbeddingModels({ root }, runner)).changed).toBe(true)
  })

  it.each(["export", "quantize"])(
    "retains the previous pair and receipt when %s fails",
    async (failure) => {
      const { root, runner, setFailure } = await fixture()
      await prepareEmbeddingModels({ root }, runner)
      const receipt = join(root, "models/.rhema-embedding-toolchain.json")
      const before = await readFile(receipt, "utf8")
      setFailure(failure)
      await expect(
        prepareEmbeddingModels({ root, force: true }, runner)
      ).rejects.toThrow(`${failure} failed`)
      expect(await readFile(receipt, "utf8")).toBe(before)
      expect(
        await readFile(
          join(root, "models/qwen3-embedding-0.6b/model.onnx"),
          "utf8"
        )
      ).toBe("complete-fp32")
      expect(
        await readFile(
          join(root, "models/qwen3-embedding-0.6b-int8/model_quantized.onnx"),
          "utf8"
        )
      ).toBe("complete-int8")
    }
  )

  it("refuses a successful command that leaves an incomplete output", async () => {
    const { root, runner } = await fixture()
    const incomplete: EmbeddingRunner = async (command) =>
      command.includes("quantize") ? "" : runner(command)
    await expect(prepareEmbeddingModels({ root }, incomplete)).rejects.toThrow(
      "synthetic missing external data"
    )
    expect(
      existsSync(join(root, "models/.rhema-embedding-toolchain.json"))
    ).toBe(false)
  })
})
