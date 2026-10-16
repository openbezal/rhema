import { expect, it } from "vitest"
import {
  resolveTranslationSelection,
  saveTranslationSelection,
} from "./translation-selection"
import type { Translation } from "@/types"
const entry = (code: string, id: number): Translation => ({
  id,
  abbreviation: code,
  title: code,
  language: "en",
  is_downloaded: true,
  is_copyrighted: true,
})
it.each(["KJV", "ESV", "NIV", "OYCB", "BSRK", "BIUO"])(
  "restores %s by stable identity after a different optional input set rebuild",
  (code) => {
    const before = ["KJV", "ESV", "NIV", "OYCB", "BSRK", "BIUO"].map(
      (code, index) => entry(code, index + 1)
    )
    const after = ["AMP", "BIUO", "BSRK", "OYCB", "NIV", "ESV", "KJV"].map(
      (code, index) => entry(code, index + 20)
    )
    const result = resolveTranslationSelection(
      after,
      saveTranslationSelection(code, before),
      before.find((t) => t.abbreviation === code)!.id
    )
    expect(result.status).toBe("ready")
    expect(result.translation?.abbreviation).toBe(code)
    expect(result.translation?.id).toBe(
      after.find((t) => t.abbreviation === code)!.id
    )
  }
)
it("requires confirmation rather than silently switching a removed local language", () => {
  const before = [entry("KJV", 1), entry("BIUO", 2)]
  const result = resolveTranslationSelection(
    [entry("KJV", 2)],
    saveTranslationSelection("BIUO", before),
    2
  )
  expect(result.status).toBe("needs_confirmation")
})
