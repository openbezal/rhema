import { convertBibleVpl, type BibleSource } from "./convert-bible-vpl"
export type { BibleSource } from "./convert-bible-vpl"
export function convertYorubaVpl(text: string): BibleSource {
 return convertBibleVpl(text, { abbreviation: "OYCB", name: "Biblica® Open Yoruba Contemporary Bible™" })
}

/** Counts for the pinned official 2025-06-25 source, including its deliberate omissions. */
export const YORUBA_VERSE_COUNTS = [
  1533, 1213, 859, 1288, 959, 658, 618, 85, 810, 695, 816, 719, 942, 822, 280,
  406, 167, 1070, 2461, 915, 222, 117, 1292, 1364, 154, 1273, 357, 197, 73,
  146, 21, 48, 105, 47, 56, 53, 38, 211, 55, 1068, 673, 1149, 878, 1003,
  432, 437, 257, 149, 155, 104, 95, 89, 47, 113, 83, 46, 25, 303, 108, 105,
  61, 105, 13, 15, 25, 404,
] as const

export function validateYorubaCorpus(source: BibleSource): void {
  if (source.books.length !== 66) throw new Error("Incomplete Yoruba corpus: expected 66 books")
  for (const [index, book] of source.books.entries()) {
    const count = book.chapters.reduce((total, chapter) => total + chapter.verses.length, 0)
    if (book.book_number !== index + 1 || count !== YORUBA_VERSE_COUNTS[index]) {
      throw new Error(`Yoruba corpus differs from the pinned source at book ${index + 1}`)
    }
  }
}
