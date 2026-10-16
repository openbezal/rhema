import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createEmbeddingPlan,
  prepareEmbeddingModels,
  prepareEmbeddingAssets,
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
      JSON.stringify([{ id: 7, text: "original" }])
    )
    await writeFile(
      join(root, "embeddings/kjv-qwen3-0.6b.bin"),
      Buffer.alloc(1024 * 4)
    )
    await writeFile(
      join(root, "embeddings/kjv-qwen3-0.6b-ids.bin"),
      new Uint8Array(new BigInt64Array([7n]).buffer)
    )
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(false)
    await recordEmbeddingIndex(root, "model-A")
    expect(await isEmbeddingIndexCurrent(root, "model-A")).toBe(true)
    expect(await isEmbeddingIndexCurrent(root, "model-B")).toBe(false)
    await writeFile(
      join(root, "data/verses-for-embedding.json"),
      JSON.stringify([{ id: 7, text: "changed" }])
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

describe("reviewed index lifecycle", () => {
  it("does not receipt empty binaries for a nonempty source", async () => {
    const { root } = await fixture()
    await mkdir(join(root, "data"))
    await mkdir(join(root, "embeddings"))
    await writeFile(
      join(root, "data/verses-for-embedding.json"),
      JSON.stringify([
        { id: 7, text: "one" },
        { id: 8, text: "two" },
      ])
    )
    await writeFile(join(root, "embeddings/kjv-qwen3-0.6b.bin"), "")
    await writeFile(join(root, "embeddings/kjv-qwen3-0.6b-ids.bin"), "")
    await expect(recordEmbeddingIndex(root, "same-model")).rejects.toThrow(
      "size"
    )
    expect(await isEmbeddingIndexCurrent(root, "same-model")).toBe(false)
  })

  it("exports the chosen directory using repository code and the stable KJV identity", async () => {
    const { root } = await fixture()
    const scripts = join(root, "repository/data")
    const selected = join(root, "chosen data")
    await mkdir(scripts, { recursive: true })
    await mkdir(selected)
    const script = join(scripts, "compute-embeddings.ts")
    await copyFile(resolve("data/compute-embeddings.ts"), script)
    for (const [directory, text] of [
      [scripts, "wrong default"],
      [selected, "chosen KJV"],
    ]) {
      const initialization = `import {Database} from 'bun:sqlite';const db=new Database(${JSON.stringify(join(directory, "rhema.db"))},{create:true});db.exec("CREATE TABLE translations(id INTEGER,abbreviation TEXT);CREATE TABLE verses(id INTEGER,translation_id INTEGER,book_name TEXT,chapter INTEGER,verse INTEGER,text TEXT);");db.query('INSERT INTO translations VALUES (?,?)').run(77,'KJV');db.query('INSERT INTO translations VALUES (?,?)').run(1,'OTHER');db.query('INSERT INTO verses VALUES (?,?,?,?,?,?)').run(7,77,'John',3,16,${JSON.stringify(text)});db.query('INSERT INTO verses VALUES (?,?,?,?,?,?)').run(8,1,'John',3,16,'wrong edition');db.close();`
      execFileSync("bun", ["-e", initialization], { stdio: "pipe" })
    }
    execFileSync("bun", [script, "--data-dir", selected], { stdio: "pipe" })
    expect(
      JSON.parse(
        await readFile(join(selected, "verses-for-embedding.json"), "utf8")
      )
    ).toEqual([{ id: 7, text: "chosen KJV", ref: "John 3:16" }])
    expect(existsSync(join(scripts, "verses-for-embedding.json"))).toBe(false)
  })

  async function bundleFixture() {
    const base = await fixture()
    const dataDir = join(base.root, "chosen data")
    await mkdir(dataDir)
    let fail = ""
    const runner: EmbeddingRunner = async (command, capture) => {
      if (command.some((part) => part.endsWith("compute-embeddings.ts"))) {
        expect(command[2]).toBe(join(base.root, "data/compute-embeddings.ts"))
        expect(command[command.indexOf("--data-dir") + 1]).toBe(dataDir)
        await writeFile(
          join(dataDir, "verses-for-embedding.json"),
          JSON.stringify([
            { id: 7, text: "one" },
            { id: 8, text: "two" },
          ])
        )
        return ""
      }
      if (command.includes("precompute")) {
        const sourcePath = command[command.indexOf("--verses") + 1]
        expect(await readFile(sourcePath, "utf8")).toBe(
          await readFile(join(dataDir, "verses-for-embedding.json"), "utf8")
        )
        const vectors = command[command.indexOf("--output-embeddings") + 1]
        const ids = command[command.indexOf("--output-ids") + 1]
        expect(vectors).not.toBe(
          join(base.root, "embeddings/kjv-qwen3-0.6b.bin")
        )
        await writeFile(
          vectors,
          fail === "command" || fail === "incomplete"
            ? ""
            : Buffer.alloc(2 * 1024 * 4)
        )
        await writeFile(
          ids,
          fail === "command" || fail === "incomplete"
            ? ""
            : new Uint8Array(
                new BigInt64Array(fail === "ids" ? [7n, 9n] : [7n, 8n]).buffer
              )
        )
        if (fail === "source")
          await writeFile(
            join(dataDir, "verses-for-embedding.json"),
            JSON.stringify([{ id: 7, text: "changed while generating" }])
          )
        if (fail === "command") throw new Error("precompute failed")
        return ""
      }
      return base.runner(command, capture)
    }
    return {
      ...base,
      dataDir,
      runner,
      setIndexFailure: (value: string) => {
        fail = value
      },
    }
  }

  it("keeps the destination lock through export, precompute and index receipt", async () => {
    const { root, dataDir, runner } = await bundleFixture()
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let sourceRefreshes = 0
    const first = prepareEmbeddingAssets(
      { root, dataDir },
      async (command, capture) => {
        if (command.includes("precompute")) {
          enter()
          await released
        }
        return runner(command, capture)
      },
      async () => {
        sourceRefreshes++
      }
    )
    await entered
    try {
      await expect(prepareEmbeddingModels({ root }, runner)).rejects.toThrow(
        "already running"
      )
      await expect(
        prepareEmbeddingAssets({ root, dataDir }, runner, async () => {
          sourceRefreshes++
        })
      ).rejects.toThrow("already running")
      expect(sourceRefreshes).toBe(1)
    } finally {
      release()
      await first
    }
    const repeated = await prepareEmbeddingAssets({ root, dataDir }, runner)
    expect(repeated.indexChanged).toBe(false)
    expect(
      JSON.parse(
        await readFile(
          join(root, "embeddings/kjv-qwen3-0.6b.meta.json"),
          "utf8"
        )
      )
    ).toMatchObject({ verse_count: 2, pooling: "masked-mean" })
  })

  it.each(["command", "incomplete", "ids", "source"])(
    "preserves the previous index/receipt on %s generation failure",
    async (failure) => {
      const { root, dataDir, runner, setIndexFailure } = await bundleFixture()
      await prepareEmbeddingAssets({ root, dataDir }, runner)
      const paths = [
        "kjv-qwen3-0.6b.bin",
        "kjv-qwen3-0.6b-ids.bin",
        "kjv-qwen3-0.6b.toolchain.json",
      ].map((name) => join(root, "embeddings", name))
      const before = await Promise.all(paths.map((path) => readFile(path)))
      setIndexFailure(failure)
      await expect(
        prepareEmbeddingAssets({ root, dataDir, force: true }, runner)
      ).rejects.toThrow(
        failure === "command"
          ? "precompute failed"
          : failure === "ids"
            ? "IDs"
            : failure === "source"
              ? "source changed"
              : "size"
      )
      expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(
        before
      )
    }
  )
})
