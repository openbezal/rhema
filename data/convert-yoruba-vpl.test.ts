import { describe, expect, it } from "vitest"
import { BIBLE_CANON } from "./lib/bible-canon"
import { convertYorubaVpl, validateYorubaCorpus } from "./convert-yoruba-vpl"

describe("independent Yoruba VPL conversion", () => {
  it("keeps canonical numbers even when the input contains only a later book", () => {
    const source = convertYorubaVpl("JOH 3:16 Àkọ́kọ́ ọ̀rọ̀.\n")
    expect(source.books).toEqual([{ book_number: 43, name: "John", chapters: [{ chapter: 3, verses: [{ verse: 16, text: "Àkọ́kọ́ ọ̀rọ̀." }] }] }])
    expect(source.translation.abbreviation).toBe("OYCB")
  })

  it("preserves Unicode, punctuation and omitted verse coordinates", () => {
    const source = convertYorubaVpl("\uFEFFMAT 17:22 “Ọ̀rọ̀ ẹlẹ́ẹ̀keji.”\r\nMAT 17:20 Ẹ̀rí àkọ́kọ́.\r\n")
    expect(source.books[0].chapters[0].verses).toEqual([
      { verse: 20, text: "Ẹ̀rí àkọ́kọ́." }, { verse: 22, text: "“Ọ̀rọ̀ ẹlẹ́ẹ̀keji.”" },
    ])
  })

  it("maps every official source book to its canonical position", () => {
    const source = convertYorubaVpl(BIBLE_CANON.map(([code]) => `${code} 1:1 Synthetic fixture.`).reverse().join("\n"))
    expect(source.books.map((book) => book.book_number)).toEqual(Array.from({ length: 66 }, (_, index) => index + 1))
    expect(source.books[65].name).toBe("Revelation")
  })

  it("does not treat a partial source as the complete packaged Bible", () => {
    expect(() => validateYorubaCorpus(convertYorubaVpl("GEN 1:1 Synthetic fixture."))).toThrow("expected 66 books")
  })

  it.each([
    "XYZ 1:1 Unknown book", "JOH 0:1 Zero chapter", "JOH 22:1 Invalid chapter",
    "JOH 1:0 Zero verse", "JOH 1:1   ", "This is not a verse",
    "JOH 1:1 One\nJOH 1:1 Duplicate", "",
  ])("rejects malformed or duplicate source rows: %j", (text) => {
    expect(() => convertYorubaVpl(text)).toThrow(/line|Empty/)
  })
})
