import { describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import {
  parseImportedThemes,
  sanitizeImportedThemes,
  serializeThemes,
} from "@/lib/theme-transfer"

describe("theme transfer", () => {
  it("serializes themes into a portable payload", () => {
    const serialized = serializeThemes([BUILTIN_THEMES[0]])
    const parsed = JSON.parse(serialized) as { app: string; version: number; themes: unknown[] }

    expect(parsed.app).toBe("rhema")
    expect(parsed.version).toBe(1)
    expect(parsed.themes).toHaveLength(1)
  })

  it("parses both wrapped payloads and raw arrays", () => {
    const wrapped = parseImportedThemes(
      JSON.stringify({
        app: "rhema",
        version: 1,
        themes: [BUILTIN_THEMES[0]],
      }),
    )
    const rawArray = parseImportedThemes(JSON.stringify([BUILTIN_THEMES[1]]))

    expect(wrapped[0]?.id).toBe(BUILTIN_THEMES[0].id)
    expect(rawArray[0]?.id).toBe(BUILTIN_THEMES[1].id)
  })

  it("rejects files without themes", () => {
    expect(() => parseImportedThemes(JSON.stringify({ nope: true }))).toThrow(
      "That file does not contain any importable themes.",
    )
  })

  it("sanitizes imported themes into custom themes with unique ids", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("imported-theme-id")

    const imported = sanitizeImportedThemes([BUILTIN_THEMES[0]], [BUILTIN_THEMES[0]])

    expect(imported[0]).toMatchObject({
      id: "imported-theme-id",
      builtin: false,
    })
  })
})
