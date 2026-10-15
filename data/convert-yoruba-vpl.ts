import { BIBLE_CANON } from "./lib/bible-canon"

export interface BibleSource {
  translation: { abbreviation: string; name: string }
  books: Array<{
    book_number: number
    name: string
    chapters: Array<{ chapter: number; verses: Array<{ verse: number; text: string }> }>
  }>
}

export function convertYorubaVpl(text: string): BibleSource {
  const canon = new Map<string, { number: number; name: string; chapters: number }>(
    BIBLE_CANON.map(([code, name, chapters], index) => [code, { number: index + 1, name, chapters }]),
  )
  const books = new Map<number, BibleSource["books"][number]>()
  const coordinates = new Set<string>()
  const lines = text.replace(/^\uFEFF/, "").split("\n")
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/, "")
    if (!line.trim()) continue
    const match = /^([A-Z0-9]{3}) ([1-9]\d*):([1-9]\d*) (.+)$/.exec(line)
    if (!match) throw new Error(`Invalid VPL row at line ${index + 1}`)
    const [, code, chapterText, verseText, content] = match
    const book = canon.get(code)
    const chapter = Number(chapterText)
    const verse = Number(verseText)
    if (!book || !Number.isSafeInteger(chapter) || chapter > book.chapters ||
        !Number.isSafeInteger(verse) || verse > 176 || !content.trim()) {
      throw new Error(`Invalid VPL coordinates or text at line ${index + 1}`)
    }
    const key = `${book.number}:${chapter}:${verse}`
    if (coordinates.has(key)) throw new Error(`Duplicate VPL verse at line ${index + 1}`)
    coordinates.add(key)
    let outputBook = books.get(book.number)
    if (!outputBook) {
      outputBook = { book_number: book.number, name: book.name, chapters: [] }
      books.set(book.number, outputBook)
    }
    let outputChapter = outputBook.chapters.find((item) => item.chapter === chapter)
    if (!outputChapter) {
      outputChapter = { chapter, verses: [] }
      outputBook.chapters.push(outputChapter)
    }
    outputChapter.verses.push({ verse, text: content })
  }
  if (!coordinates.size) throw new Error("Empty VPL source")
  const result = [...books.values()].sort((a, b) => a.book_number - b.book_number)
  for (const book of result) {
    book.chapters.sort((a, b) => a.chapter - b.chapter)
    for (const chapter of book.chapters) chapter.verses.sort((a, b) => a.verse - b.verse)
  }
  return { translation: { abbreviation: "OYCB", name: "Biblica® Open Yoruba Contemporary Bible™" }, books: result }
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
