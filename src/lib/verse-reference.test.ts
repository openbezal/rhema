import { describe, expect, it } from "vitest"
import type { VerseRenderData } from "@/types"
import { formatVerseReference } from "./verse-reference"
import { SAMPLE_VERSE } from "./theme-migrations"
import { BILINGUAL_DESIGN_SAMPLE } from "./designer-sample"

const verse: VerseRenderData = {
  reference: "1 John 3:16 (ESV · KJV)",
  address: {
    bookNumber: 62,
    bookName: "1 John",
    chapter: 3,
    verse: 16,
    translationCode: "ESV",
    secondaryTranslationCode: "KJV",
  },
  segments: [{ verseNumber: 16, text: "Primary" }],
}

describe("structured displayed verse references", () => {
  it("keeps the full address by default and the numbered book when hiding verse numbers", () => {
    expect(formatVerseReference(verse)).toBe("1 John 3:16 (ESV · KJV)")
    expect(formatVerseReference(verse, false)).toBe("1 John 3 (ESV · KJV)")
    expect(verse.segments[0].verseNumber).toBe(16)
  })
  it("preserves Unicode book names and primary-only attribution", () => {
    const address = {
      ...verse.address!,
      bookName: "Ọ̀rọ̀ 1",
      translationCode: "BIUO",
    }
    delete address.secondaryTranslationCode
    expect(formatVerseReference({ ...verse, address }, false)).toBe(
      "Ọ̀rọ̀ 1 3 (BIUO)"
    )
  })
  it("uses the explicit display label without changing numbered canonical coordinates or body content", () => {
    const renamed = {
      ...verse,
      address: { ...verse.address!, displayBookName: "1 Ọ̀rọ̀" },
    }
    expect(formatVerseReference(renamed)).toBe("1 Ọ̀rọ̀ 3:16 (ESV · KJV)")
    expect(formatVerseReference(renamed, false)).toBe("1 Ọ̀rọ̀ 3 (ESV · KJV)")
    expect(renamed.address.bookName).toBe("1 John")
  })
  it("leaves old string-only frames intact without guessing where their numbers are", () => {
    for (const reference of [
      "1 John 3:16 (KJV)",
      "Ọ̀rọ̀ 1 3:16–18 (BIUO)",
      "A legacy custom reference",
    ]) {
      expect(formatVerseReference({ reference, segments: [] }, false)).toBe(
        reference
      )
    }
  })
  it.each([
    null,
    {},
    { ...verse.address, bookNumber: 0 },
    { ...verse.address, bookNumber: 67 },
    { ...verse.address, bookName: " " },
    { ...verse.address, chapter: 0 },
    { ...verse.address, verse: 1.5 },
    { ...verse.address, translationCode: "" },
    { ...verse.address, secondaryTranslationCode: 2 },
  ])(
    "falls back verbatim for a malformed structured address: %j",
    (address) => {
      const malformed = { ...verse, address } as unknown as VerseRenderData
      expect(formatVerseReference(malformed, false)).toBe(verse.reference)
    }
  )
  it("gives offline single and bilingual designer samples the same reference control", () => {
    expect(formatVerseReference(SAMPLE_VERSE, false)).toBe("Genesis 1 (KJV)")
    expect(formatVerseReference(BILINGUAL_DESIGN_SAMPLE, false)).toBe(
      "Genesis 1 (KJV · OYCB)"
    )
  })
})
