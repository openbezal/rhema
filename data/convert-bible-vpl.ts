import { BIBLE_CANON } from "./lib/bible-canon"

export interface BibleSource {
  translation: { abbreviation: string; name: string }
  books: Array<{
    book_number: number
    name: string
    chapters: Array<{
      chapter: number
      verses: Array<{ verse: number; text: string }>
    }>
  }>
}

export function convertBibleVpl(
  text: string,
  translation: BibleSource["translation"]
): BibleSource {
  const canon = new Map<
    string,
    { number: number; name: string; chapters: number }
  >(
    BIBLE_CANON.map(([code, name, chapters], index) => [
      code,
      { number: index + 1, name, chapters },
    ])
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
    if (
      !book ||
      !Number.isSafeInteger(chapter) ||
      chapter > book.chapters ||
      !Number.isSafeInteger(verse) ||
      verse > 176 ||
      !content.trim()
    ) {
      throw new Error(`Invalid VPL coordinates or text at line ${index + 1}`)
    }
    const key = `${book.number}:${chapter}:${verse}`
    if (coordinates.has(key))
      throw new Error(`Duplicate VPL verse at line ${index + 1}`)
    coordinates.add(key)
    let outputBook = books.get(book.number)
    if (!outputBook) {
      outputBook = { book_number: book.number, name: book.name, chapters: [] }
      books.set(book.number, outputBook)
    }
    let outputChapter = outputBook.chapters.find(
      (item) => item.chapter === chapter
    )
    if (!outputChapter) {
      outputChapter = { chapter, verses: [] }
      outputBook.chapters.push(outputChapter)
    }
    outputChapter.verses.push({ verse, text: content })
  }
  if (!coordinates.size) throw new Error("Empty VPL source")
  const result = [...books.values()].sort(
    (a, b) => a.book_number - b.book_number
  )
  for (const book of result) {
    book.chapters.sort((a, b) => a.chapter - b.chapter)
    for (const chapter of book.chapters)
      chapter.verses.sort((a, b) => a.verse - b.verse)
  }
  return { translation: { ...translation }, books: result }
}

/** Coverage is checked against the reviewed edition, not KJV verse totals. */
export function validateBibleCorpus(
  source: BibleSource,
  expectedBookCounts: readonly number[]
): void {
  if (source.books.length !== 66 || expectedBookCounts.length !== 66)
    throw new Error("Incomplete Bible corpus: expected 66 books")
  for (const [index, book] of source.books.entries()) {
    const chapters = BIBLE_CANON[index][2]
    if (
      book.book_number !== index + 1 ||
      book.chapters.length !== chapters ||
      book.chapters.some((chapter, i) => chapter.chapter !== i + 1)
    )
      throw new Error(`Incomplete Bible chapters at book ${index + 1}`)
    if (
      book.chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0) !==
      expectedBookCounts[index]
    )
      throw new Error(`Bible verse coverage differs at book ${index + 1}`)
  }
}
