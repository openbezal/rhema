import { describe, expect, test } from "vitest"
import { parseYorubaVpl, YORUBA_BOOK_CODES } from "./convert-yoruba-vpl"

describe("parseYorubaVpl", () => {
  test("preserves Yoruba verse text and groups chapters", () => {
    const lines = YORUBA_BOOK_CODES.map((code) => `${code} 1:1 ${code} text`)
    lines[0] = "GEN 1:1 Ní ìbẹ̀rẹ̀ ohun gbogbo Ọlọ́run dá àwọn ọ̀run àti ayé."
    lines.splice(1, 0, "GEN 1:2 Ayé sì wà ní rúdurùdu.")
    lines[lines.length - 1] =
      "REV 22:21 Oore-ọ̀fẹ́ Jesu Olúwa kí ó wà pẹ̀lú gbogbo àwọn ènìyàn mímọ́. Àmín."
    const bible = parseYorubaVpl(lines.join("\n"))

    expect(bible.books).toHaveLength(66)
    expect(bible.books[0]).toEqual({
      name: "Genesis",
      chapters: [
        {
          chapter: 1,
          verses: [
            {
              verse: 1,
              text: "Ní ìbẹ̀rẹ̀ ohun gbogbo Ọlọ́run dá àwọn ọ̀run àti ayé.",
            },
            { verse: 2, text: "Ayé sì wà ní rúdurùdu." },
          ],
        },
      ],
    })
    expect(bible.books[65].chapters[0].verses[0].verse).toBe(21)
  })

  test("rejects an incomplete source", () => {
    expect(() => parseYorubaVpl("GEN 1:1 Text")).toThrow("books are missing")
  })
})
