import { expect, it } from "vitest"
import { convertBibleVpl, validateBibleCorpus } from "./convert-bible-vpl"
import { BIBLE_CANON } from "./lib/bible-canon"
const edition = {
  abbreviation: "BSRK",
  name: "Biblica® Open Hausa Contemporary Bible™",
}
it("preserves Hausa/Igbo Unicode and the requested edition identity", () => {
  const source = convertBibleVpl(
    "GEN 1:1 Ƙasa da ƙauna.\nJOH 3:16 Nʼihi ụwa.\n",
    edition
  )
  expect(source.translation).toEqual(edition)
  expect(source.books.map((book) => book.book_number)).toEqual([1, 43])
  expect(source.books[1].chapters[0].verses[0].text).toBe("Nʼihi ụwa.")
})
it("maps every canonical book independently of source order", () => {
  const source = convertBibleVpl(
    BIBLE_CANON.map(([code]) => `${code} 1:1 Synthetic fixture.`)
      .reverse()
      .join("\n"),
    edition
  )
  expect(source.books.map((book) => book.book_number)).toEqual(
    Array.from({ length: 66 }, (_, i) => i + 1)
  )
  expect(source.books[61].name).toBe("1 John")
})
it.each([
  "XYZ 1:1 Bad",
  "JOH 22:1 Bad",
  "GEN 1:1 One\nGEN 1:1 Duplicate",
  "GEN 1:1   ",
  "",
])("rejects malformed/duplicate VPL: %s", (text) => {
  expect(() => convertBibleVpl(text, edition)).toThrow()
})
it("rejects a missing chapter even when the per-book total matches", () => {
  const source = convertBibleVpl(
    BIBLE_CANON.map(([code]) => `${code} 1:1 Synthetic fixture.`).join("\n"),
    edition
  )
  expect(() => validateBibleCorpus(source, Array(66).fill(1))).toThrow(
    /chapter/
  )
})
it("retains deliberate omitted verse numbers without renumbering", () => {
  const source = convertBibleVpl("MAT 17:20 One.\nMAT 17:22 Two.", edition)
  expect(source.books[0].chapters[0].verses.map((v) => v.verse)).toEqual([
    20, 22,
  ])
})
