import { describe, expect, it } from "vitest"
import type { VerseRenderData } from "@/types"
import {
  BookDisplayOverridesSchema,
  displayBookName,
  displayVerseReference,
  displayBooks,
  applyBookDisplayNames,
  replaceEditionBookNames,
} from "./book-display-names"
const names = [{ translationCode: "KJV", bookNumber: 66, label: "Revelation" }]
const verse = {
  book_name: "Revelation of John",
  book_number: 66,
  chapter: 1,
  verse: 2,
}
const rendered: VerseRenderData = {
  reference: "Revelation of John 1:2 (KJV · BIUO)",
  address: {
    bookNumber: 66,
    bookName: "Revelation of John",
    chapter: 1,
    verse: 2,
    translationCode: "KJV",
    secondaryTranslationCode: "BIUO",
  },
  segments: [{ verseNumber: 2, text: "Verified" }],
  secondary: {
    translationCode: "BIUO",
    segments: [{ verseNumber: 2, text: "Second" }],
  },
}
describe("stable book display names", () => {
  it("shortens Revelation by stable edition and canonical number, keeping other editions and source data", () => {
    expect(displayBookName("Revelation of John", 66, "KJV", names)).toBe(
      "Revelation"
    )
    expect(displayBookName("Revelation of John", 66, "BIUO", names)).toBe(
      "Revelation of John"
    )
    expect(displayVerseReference(verse, "KJV", names)).toBe("Revelation 1:2")
    expect(verse.book_name).toBe("Revelation of John")
  })
  it("keeps legacy ranges intact and uses known coordinates across numbered-book label forms", () => {
    expect(
      displayVerseReference(
        verse,
        "KJV",
        names,
        false,
        "Revelation of John 1:2–4"
      )
    ).toBe("Revelation 1:2–4")
    expect(
      displayVerseReference(verse, "KJV", names, false, "Old custom range")
    ).toBe("Old custom range")
    expect(
      displayVerseReference(
        { book_name: "I John", book_number: 62, chapter: 2, verse: 3 },
        "KJV",
        [{ translationCode: "KJV", bookNumber: 62, label: "1 Ọ̀rọ̀" }],
        false,
        "1 John 2:3"
      )
    ).toBe("1 Ọ̀rọ̀ 2:3")
  })
  it("relabels structured frames immutably while retaining canonical address, both texts and edition labels", () => {
    const changed = applyBookDisplayNames(rendered, names)
    expect(changed.reference).toBe("Revelation 1:2 (KJV · BIUO)")
    expect(changed.address).toMatchObject({
      bookName: "Revelation of John",
      displayBookName: "Revelation",
      bookNumber: 66,
    })
    expect(changed.segments).toBe(rendered.segments)
    expect(changed.secondary).toBe(rendered.secondary)
    expect(rendered.address).not.toHaveProperty("displayBookName")
    expect(applyBookDisplayNames(changed, names)).toBe(changed)
    expect(applyBookDisplayNames(changed, []).reference).toBe(
      rendered.reference
    )
    const legacy = { reference: "1 John 2:3", segments: [] }
    expect(applyBookDisplayNames(legacy, names)).toBe(legacy)
  })
  it("keeps canonical search metadata alongside the displayed name even when numeric database IDs change", () => {
    const books = [
      {
        id: 900,
        translation_id: 99,
        book_number: 66,
        name: "Revelation of John",
        abbreviation: "Rev",
        testament: "NT",
      },
    ]
    const displayed = displayBooks(books, "KJV", names)
    expect(displayed[0]).toMatchObject({
      id: 900,
      book_number: 66,
      name: "Revelation of John",
      displayName: "Revelation",
    })
    expect(books[0]).not.toHaveProperty("displayName")
  })
  it("saves only the selected edition's changes and resets blank names without losing future editions", () => {
    const other = { translationCode: "FUTURE", bookNumber: 62, label: "1 Ọ̀rọ̀" }
    expect(
      replaceEditionBookNames([...names, other], "KJV", [
        { bookNumber: 66, canonicalName: "Revelation of John", label: "  " },
      ])
    ).toEqual([other])
    expect(
      replaceEditionBookNames([other], "KJV", [
        {
          bookNumber: 66,
          canonicalName: "Revelation of John",
          label: "Revelation of John",
        },
      ])
    ).toEqual([other])
    expect(
      replaceEditionBookNames([other], "KJV", [
        {
          bookNumber: 66,
          canonicalName: "Revelation of John",
          label: " Revelation ",
        },
      ])
    ).toEqual([other, ...names])
  })
  it("normalizes Unicode and preserves numbered labels", () => {
    expect(
      BookDisplayOverridesSchema.parse([
        {
          translationCode: "BIUO",
          bookNumber: 62,
          label: " 1 O\u0323\u0300ro\u0323\u0300 ",
        },
      ])[0].label
    ).toBe("1 O\u0323\u0300ro\u0323\u0300".normalize("NFC"))
  })
  it("keeps names for books absent from the current edition list when saving a partial catalog", () => {
    const unseen = { translationCode: "KJV", bookNumber: 1, label: "Beginning" }
    expect(
      replaceEditionBookNames([unseen, ...names], "KJV", [
        { bookNumber: 66, canonicalName: "Revelation of John", label: "" },
      ])
    ).toEqual([unseen])
  })
  it.each([
    [{ ...names[0], bookNumber: 0 }],
    [{ ...names[0], bookNumber: 67 }],
    [{ ...names[0], bookNumber: 1.5 }],
    [{ ...names[0], translationCode: "__proto__" }],
    [{ ...names[0], translationCode: "kjv" }],
    [{ ...names[0], label: " " }],
    [{ ...names[0], label: "x".repeat(121) }],
    [{ ...names[0], label: "Line\nBreak" }],
    [{ ...names[0], label: "A\u0085B" }],
    [names[0], names[0]],
    Array.from({ length: 6601 }, (_, bookNumber) => ({
      ...names[0],
      bookNumber,
    })),
  ])("rejects invalid, ambiguous or oversized preference lists", (input) => {
    expect(BookDisplayOverridesSchema.safeParse(input).success).toBe(false)
  })
})
