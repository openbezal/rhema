/**
 * Convert eBible's Yoruba VPL export to Rhema's Scrollmapper-compatible JSON.
 *
 * Source: https://ebible.org/Scriptures/yor_vpl.zip
 * License: CC BY-SA 4.0 (Biblica, Inc.)
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DATA_DIR = import.meta.dir ?? process.cwd()
const DEFAULT_INPUT = join(DATA_DIR, "yor_vpl.txt")
const DEFAULT_OUTPUT = join(DATA_DIR, "sources", "OYCB.json")

const BOOKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "GEN", name: "Genesis" },
  { code: "EXO", name: "Exodus" },
  { code: "LEV", name: "Leviticus" },
  { code: "NUM", name: "Numbers" },
  { code: "DEU", name: "Deuteronomy" },
  { code: "JOS", name: "Joshua" },
  { code: "JDG", name: "Judges" },
  { code: "RUT", name: "Ruth" },
  { code: "1SA", name: "1 Samuel" },
  { code: "2SA", name: "2 Samuel" },
  { code: "1KI", name: "1 Kings" },
  { code: "2KI", name: "2 Kings" },
  { code: "1CH", name: "1 Chronicles" },
  { code: "2CH", name: "2 Chronicles" },
  { code: "EZR", name: "Ezra" },
  { code: "NEH", name: "Nehemiah" },
  { code: "EST", name: "Esther" },
  { code: "JOB", name: "Job" },
  { code: "PSA", name: "Psalms" },
  { code: "PRO", name: "Proverbs" },
  { code: "ECC", name: "Ecclesiastes" },
  { code: "SOL", name: "Song of Solomon" },
  { code: "ISA", name: "Isaiah" },
  { code: "JER", name: "Jeremiah" },
  { code: "LAM", name: "Lamentations" },
  { code: "EZE", name: "Ezekiel" },
  { code: "DAN", name: "Daniel" },
  { code: "HOS", name: "Hosea" },
  { code: "JOE", name: "Joel" },
  { code: "AMO", name: "Amos" },
  { code: "OBA", name: "Obadiah" },
  { code: "JON", name: "Jonah" },
  { code: "MIC", name: "Micah" },
  { code: "NAH", name: "Nahum" },
  { code: "HAB", name: "Habakkuk" },
  { code: "ZEP", name: "Zephaniah" },
  { code: "HAG", name: "Haggai" },
  { code: "ZEC", name: "Zechariah" },
  { code: "MAL", name: "Malachi" },
  { code: "MAT", name: "Matthew" },
  { code: "MAR", name: "Mark" },
  { code: "LUK", name: "Luke" },
  { code: "JOH", name: "John" },
  { code: "ACT", name: "Acts" },
  { code: "ROM", name: "Romans" },
  { code: "1CO", name: "1 Corinthians" },
  { code: "2CO", name: "2 Corinthians" },
  { code: "GAL", name: "Galatians" },
  { code: "EPH", name: "Ephesians" },
  { code: "PHI", name: "Philippians" },
  { code: "COL", name: "Colossians" },
  { code: "1TH", name: "1 Thessalonians" },
  { code: "2TH", name: "2 Thessalonians" },
  { code: "1TI", name: "1 Timothy" },
  { code: "2TI", name: "2 Timothy" },
  { code: "TIT", name: "Titus" },
  { code: "PHM", name: "Philemon" },
  { code: "HEB", name: "Hebrews" },
  { code: "JAM", name: "James" },
  { code: "1PE", name: "1 Peter" },
  { code: "2PE", name: "2 Peter" },
  { code: "1JO", name: "1 John" },
  { code: "2JO", name: "2 John" },
  { code: "3JO", name: "3 John" },
  { code: "JUD", name: "Jude" },
  { code: "REV", name: "Revelation" },
]

export const YORUBA_BOOK_CODES = BOOKS.map(({ code }) => code)

interface Verse {
  verse: number
  text: string
}

interface Chapter {
  chapter: number
  verses: Verse[]
}

interface ScrollmapperJSON {
  translation: { name: string; abbreviation: string }
  books: Array<{ name: string; chapters: Chapter[] }>
}

/** Parse the plain VPL format without touching the source verse text. */
export function parseYorubaVpl(input: string): ScrollmapperJSON {
  const books = BOOKS.map(({ name }) => ({ name, chapters: [] as Chapter[] }))
  const bookIndexes = new Map(BOOKS.map(({ code }, index) => [code, index]))

  for (const [lineNumber, line] of input.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue
    const match = /^(\w+)\s+(\d+):(\d+)\s?(.*)$/u.exec(line)
    if (!match) {
      throw new Error(`Invalid Yoruba VPL line ${lineNumber + 1}: ${line}`)
    }

    const [, code, chapterValue, verseValue, text] = match
    const bookIndex = bookIndexes.get(code)
    if (bookIndex === undefined) {
      throw new Error(`Unknown Yoruba VPL book code on line ${lineNumber + 1}: ${code}`)
    }

    const chapterNumber = Number(chapterValue)
    const verseNumber = Number(verseValue)
    const book = books[bookIndex]
    let chapter = book.chapters.at(-1)
    if (!chapter || chapter.chapter !== chapterNumber) {
      chapter = { chapter: chapterNumber, verses: [] }
      book.chapters.push(chapter)
    }
    chapter.verses.push({ verse: verseNumber, text })
  }

  if (books.some((book) => book.chapters.length === 0)) {
    throw new Error("Yoruba VPL source is incomplete: one or more Bible books are missing")
  }

  return {
    translation: {
      name: "Open Yoruba Contemporary Bible",
      abbreviation: "OYCB",
    },
    books,
  }
}

export function convertYorubaVpl(inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT): void {
  const source = readFileSync(inputPath, "utf8")
  const data = parseYorubaVpl(source)
  writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  const verseCount = data.books.reduce(
    (total, book) => total + book.chapters.reduce((sum, chapter) => sum + chapter.verses.length, 0),
    0,
  )
  console.log(`  ✓ OYCB: ${data.books.length} books, ${verseCount} verses → ${outputPath}`)
}

if (import.meta.main) {
  const [inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT] = Bun.argv.slice(2)
  convertYorubaVpl(inputPath, outputPath)
}
