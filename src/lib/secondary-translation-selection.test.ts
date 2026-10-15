import { expect, it } from "vitest"
import {
  resolveSecondaryTranslation,
  saveTranslationSelection,
} from "./translation-selection"
const catalog = [
  {
    id: 9,
    abbreviation: "ESV",
    title: "English",
    language: "en",
    is_downloaded: true,
    is_copyrighted: true,
  },
  {
    id: 2,
    abbreviation: "OYCB",
    title: "Yoruba",
    language: "yo",
    is_downloaded: true,
    is_copyrighted: true,
  },
]
it("keeps old primary-only selections secondary-free", () => {
  expect(
    resolveSecondaryTranslation(
      catalog,
      { version: 1, code: "ESV", catalog: { ESV: 2 } },
      "ESV"
    )
  ).toBeNull()
})
it("resolves the optional stable code across numeric ID changes", () => {
  const saved = {
    version: 1,
    code: "ESV",
    secondaryCode: " oycb ",
    catalog: { ESV: 2, OYCB: 9 },
  }
  expect(resolveSecondaryTranslation(catalog, saved, "ESV")).toBe("OYCB")
})
it.each([
  null,
  { version: 2, secondaryCode: "OYCB" },
  { version: 1, secondaryCode: 2 },
  { version: 1, secondaryCode: "MISSING" },
  { version: 1, secondaryCode: "ESV" },
])(
  "normalizes absent/equal/unavailable optional choices to None: %j",
  (saved) => {
    expect(resolveSecondaryTranslation(catalog, saved, "ESV")).toBeNull()
  }
)
it("rejects ambiguous optional codes rather than borrowing an arbitrary ID", () => {
  expect(
    resolveSecondaryTranslation(
      [...catalog, { ...catalog[1], id: 42 }],
      { version: 1, secondaryCode: "OYCB" },
      "ESV"
    )
  ).toBeNull()
})
it("saves both stable codes in one ordered selection record, omitting None", () => {
  expect(saveTranslationSelection("ESV", catalog, "OYCB")).toMatchObject({
    version: 1,
    code: "ESV",
    secondaryCode: "OYCB",
    catalog: { ESV: 9, OYCB: 2 },
  })
  expect(saveTranslationSelection("ESV", catalog, null)).not.toHaveProperty(
    "secondaryCode"
  )
})
