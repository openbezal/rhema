import { beforeEach, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}))
vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
}))
import { exportTheme, importTheme } from "./theme-designer-files"
import { BUILTIN_THEMES } from "./builtin-themes"

beforeEach(() => {
  native.invoke.mockReset()
})

it("exports the complete Unicode theme through atomic document saving", async () => {
  const theme = { ...BUILTIN_THEMES[0], name: "Ọlọ́run — Chineke" }
  native.invoke.mockResolvedValue(true)
  await expect(exportTheme(theme)).resolves.toBe(true)
  expect(native.invoke).toHaveBeenCalledWith("save_export_document", {
    content: JSON.stringify(theme, null, 2),
    format: "json",
    defaultName: "Ọlọ́run — Chineke",
  })
})

it("reports a cancelled export without claiming a saved file", async () => {
  native.invoke.mockResolvedValue(false)
  await expect(exportTheme(BUILTIN_THEMES[0])).resolves.toBe(false)
})

it("propagates a failed write to the caller", async () => {
  native.invoke.mockRejectedValue(new Error("Disk full"))
  await expect(exportTheme(BUILTIN_THEMES[0])).rejects.toThrow("Disk full")
})

it("returns no imported theme when the native dialog is cancelled", async () => {
  native.invoke.mockResolvedValue(null)
  await expect(importTheme()).resolves.toBeNull()
  expect(native.invoke).toHaveBeenCalledWith("read_import_document")
})

it("imports Unicode with a fresh identity while preserving layout", async () => {
  const theme = { ...BUILTIN_THEMES[0], name: "Ọlọ́run — Chineke" }
  native.invoke.mockResolvedValue({
    name: "theme.json",
    text: JSON.stringify(theme),
  })
  const imported = await importTheme()
  expect(imported).toMatchObject({
    name: "Ọlọ́run — Chineke",
    builtin: false,
    layout: theme.layout,
  })
  expect(imported?.id).not.toBe(theme.id)
  expect(theme).toEqual({ ...BUILTIN_THEMES[0], name: "Ọlọ́run — Chineke" })
})

it("rejects malformed imports before returning a theme", async () => {
  native.invoke.mockResolvedValue({ name: "invalid.json", text: '{"broken":' })
  await expect(importTheme()).rejects.toThrow()
})
