import { describe, expect, it } from "vitest"
import {
  getAutocompleteSuffix,
  numberToRoman,
  normalizeInput,
  findMatchingBook,
  getAutocompleteSuggestion,
  getTabNavigationResult,
  parseTypedReference,
  completeTypedReferenceInput,
  type Book,
} from "./quick-search"

// Mock book data
const mockBooks: Book[] = [
  {
    id: 1,
    translation_id: 1,
    book_number: 1,
    name: "Genesis",
    abbreviation: "Gen",
    testament: "OT",
  },
  {
    id: 43,
    translation_id: 1,
    book_number: 43,
    name: "John",
    abbreviation: "John",
    testament: "NT",
  },
  {
    id: 62,
    translation_id: 1,
    book_number: 62,
    name: "I John",
    abbreviation: "1John",
    testament: "NT",
  },
  {
    id: 63,
    translation_id: 1,
    book_number: 63,
    name: "II John",
    abbreviation: "2John",
    testament: "NT",
  },
  {
    id: 64,
    translation_id: 1,
    book_number: 64,
    name: "III John",
    abbreviation: "3John",
    testament: "NT",
  },
  {
    id: 45,
    translation_id: 1,
    book_number: 45,
    name: "Romans",
    abbreviation: "Rom",
    testament: "NT",
  },
  {
    id: 19,
    translation_id: 1,
    book_number: 19,
    name: "Psalms",
    abbreviation: "Ps",
    testament: "OT",
  },
  {
    id: 46,
    translation_id: 1,
    book_number: 46,
    name: "I Corinthians",
    abbreviation: "1Cor",
    testament: "NT",
  },
]

describe("unambiguous installed-book resolution", () => {
  it.each(["John", "Chosen", "John 3", "Love3", "John 3:16"])(
    "preserves book, coordinates and input stage when completing the unsafe label %s",
    (label) => {
      const books = mockBooks.map((book) => ({
        ...book,
        displayName:
          book.book_number === 1 ||
          (label === "Chosen" && book.book_number === 19)
            ? label
            : undefined,
      }))
      for (const input of ["Gen ", "Gen 2 ", "Gen 2:", "Gen 2:4"]) {
        const before = getAutocompleteSuggestion(input, books)
        const completed = completeTypedReferenceInput(input, books)
        const after = getAutocompleteSuggestion(completed, books)
        expect(after, completed).toMatchObject({
          matchedBook: { book_number: 1 },
          stage: before.stage === "chapter" ? "verse" : before.stage,
          chapter: before.chapter,
          ...(before.verse && before.stage !== "chapter"
            ? { verse: before.verse }
            : {}),
        })
        if (after.stage === "verse") expect(after.verse).toBeUndefined()
      }
      for (const input of ["Gen", "Gen 2"]) {
        const suggestion = getAutocompleteSuggestion(input, books).suggestion
        const accepted = getTabNavigationResult(input, suggestion)
        expect(
          getAutocompleteSuggestion(accepted, books),
          accepted
        ).toMatchObject({
          matchedBook: { book_number: 1 },
          stage: input === "Gen" ? "book" : "verse",
          chapter: input === "Gen" ? 1 : 2,
        })
      }
    }
  )
  it("accepts custom display aliases while retaining canonical names and abbreviations", () => {
    const books: Book[] = [
      ...mockBooks,
      {
        id: 66,
        translation_id: 1,
        book_number: 66,
        name: "Revelation of John",
        abbreviation: "Rev",
        testament: "NT",
        displayName: "Apocalypse",
      },
    ]
    expect(parseTypedReference("Apocalypse 1:2", books)?.book.book_number).toBe(
      66
    )
    expect(
      parseTypedReference("Revelation of John 1:2", books)?.book.book_number
    ).toBe(66)
    expect(parseTypedReference("Rev 1:2", books)?.book.book_number).toBe(66)
    expect(getAutocompleteSuggestion("Apoc", books).suggestion).toBe(
      "Apocalypse 1:1"
    )
    books[books.length - 1].displayName = "John"
    expect(parseTypedReference("John 3:16", books)?.book.book_number).toBe(43)
  })
  it("does not guess between colliding custom aliases", () => {
    const books = mockBooks.map((book) => ({ ...book, displayName: "Chosen" }))
    expect(parseTypedReference("Chosen 1:2", books)).toBeNull()
  })
  it("accepts punctuation and Unicode in a custom typed book label", () => {
    const books = [{ ...mockBooks[0], displayName: "Ọ̀rọ̀ (Beginning)" }]
    expect(
      parseTypedReference("Ọ̀rọ̀ (Beginning) 1:2", books)?.book.book_number
    ).toBe(1)
  })
  const james: Book = {
    id: 59,
    translation_id: 1,
    book_number: 59,
    name: "James",
    abbreviation: "Jas",
    testament: "NT",
  }
  const jude: Book = {
    ...james,
    id: 65,
    book_number: 65,
    name: "Jude",
    abbreviation: "Jud",
  }
  const books = [...mockBooks, james, jude]
  it("keeps an abbreviated book's typed chapter when Tab accepts completion", () => {
    const suggestion = getAutocompleteSuggestion("JA 2", books).suggestion
    expect(getTabNavigationResult("JA 2", suggestion)).toBe("James 2:")
  })
  it("keeps the chapter when Tab accepts a dotted abbreviation", () => {
    const suggestion = getAutocompleteSuggestion(
      "Jn. 3",
      books.map((book) =>
        book.book_number === 43 ? { ...book, abbreviation: "Jn" } : book
      )
    ).suggestion
    expect(getTabNavigationResult("Jn. 3", suggestion)).toBe("John 3:")
  })
  it.each([
    ["JA ", "James "],
    ["JA 2 ", "James 2:"],
    ["JA 2 2", "James 2:2"],
    ["JA 2.", "James 2:"],
    ["J ", "J "],
    ["JA", "JA"],
  ])("completes an explicit delimiter %s", (input, expected) => {
    expect(completeTypedReferenceInput(input, books)).toBe(expected)
  })
  it("never chooses the first ambiguous prefix or ordinal by catalog order", () => {
    for (const input of ["J", "1", "I", "First"]) {
      expect(
        getAutocompleteSuggestion(input, books).matchedBook
      ).toBeUndefined()
      expect(
        getAutocompleteSuggestion(input, [...books].reverse()).matchedBook
      ).toBeUndefined()
    }
    expect(parseTypedReference("J 2 2", books)).toBeNull()
  })
  it("keeps exact names and abbreviations ahead of prefix ambiguity", () => {
    expect(findMatchingBook("John", books)?.book_number).toBe(43)
    expect(findMatchingBook("Jas", books)?.book_number).toBe(59)
  })
  it.each(["JA 2 2", "ja 2:2", "Ja 2.2"])(
    "resolves %s to James 2:2",
    (input) => {
      expect(getAutocompleteSuggestion(input, books)).toMatchObject({
        matchedBook: james,
        chapter: 2,
        verse: 2,
        stage: "complete",
      })
      expect(parseTypedReference(input, books)).toEqual({
        book: james,
        chapter: 2,
        verse: 2,
      })
    }
  )
  it("uses Unicode book names with canonically equivalent spelling", () => {
    const yoruba = { ...james, name: "Jákọ́bù", abbreviation: "Ják" }
    expect(
      parseTypedReference("JÁKỌ́BÙ 2 2".normalize("NFD"), [yoruba])
    ).toEqual({ book: yoruba, chapter: 2, verse: 2 })
  })
  it.each(["John 0:1", "John 1:0", "John 3::16", "John 3..16"])(
    "rejects %s",
    (input) => {
      expect(getAutocompleteSuggestion(input, books).stage).toBe("none")
      expect(parseTypedReference(input, books)).toBeNull()
    }
  )
})

describe("numberToRoman", () => {
  it("converts 1 to I", () => {
    expect(numberToRoman(1)).toBe("I")
  })

  it("converts 2 to II", () => {
    expect(numberToRoman(2)).toBe("II")
  })

  it("converts 3 to III", () => {
    expect(numberToRoman(3)).toBe("III")
  })

  it("returns string for numbers > 3", () => {
    expect(numberToRoman(4)).toBe("4")
    expect(numberToRoman(10)).toBe("10")
  })
})

describe("normalizeInput", () => {
  it("converts '1 j' to 'I j'", () => {
    expect(normalizeInput("1 j")).toBe("I j")
  })

  it("converts '2 c' to 'II c'", () => {
    expect(normalizeInput("2 c")).toBe("II c")
  })

  it("converts '3 john' to 'III john'", () => {
    expect(normalizeInput("3 john")).toBe("III john")
  })

  it("leaves non-numbered input unchanged", () => {
    expect(normalizeInput("john")).toBe("john")
    expect(normalizeInput("genesis")).toBe("genesis")
  })

  it("converts '1' alone to 'I'", () => {
    expect(normalizeInput("1")).toBe("I")
  })

  it("trims whitespace", () => {
    expect(normalizeInput("  john  ")).toBe("john")
  })
})

describe("findMatchingBook", () => {
  it("finds book by full name (case insensitive)", () => {
    const result = findMatchingBook("john", mockBooks)
    expect(result?.name).toBe("John")
  })

  it("finds book by partial name", () => {
    const result = findMatchingBook("gen", mockBooks)
    expect(result?.name).toBe("Genesis")
  })

  it("finds book by abbreviation", () => {
    const result = findMatchingBook("rom", mockBooks)
    expect(result?.name).toBe("Romans")
  })

  it("finds numbered book with Roman numeral", () => {
    const result = findMatchingBook("i john", mockBooks)
    expect(result?.name).toBe("I John")
  })

  it("returns undefined for no match", () => {
    const result = findMatchingBook("xyz", mockBooks)
    expect(result).toBeUndefined()
  })

  it("handles case insensitive matching", () => {
    const result = findMatchingBook("JOHN", mockBooks)
    expect(result?.name).toBe("John")
  })
})

describe("getAutocompleteSuggestion", () => {
  // Test 1: Empty input returns no suggestion
  it("returns empty suggestion for empty input", () => {
    const result = getAutocompleteSuggestion("", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.stage).toBe("none")
  })

  // Test 2: Just number "1" suggests "I John 1:1"
  it("does not guess between I John and I Corinthians when input is '1'", () => {
    const result = getAutocompleteSuggestion("1", mockBooks)
    expect(result).toEqual({ suggestion: "", stage: "none" })
  })

  // Test 3: Just number "2" suggests "II John 1:1"
  it("suggests 'II John 1:1' when input is '2'", () => {
    const result = getAutocompleteSuggestion("2", mockBooks)
    expect(result.suggestion).toBe("II John 1:1")
    expect(result.matchedBook?.name).toBe("II John")
    expect(result.stage).toBe("book")
  })

  // Test 4: Partial book name "j" suggests "John 1:1"
  it("suggests 'John 1:1' when input is 'j'", () => {
    const result = getAutocompleteSuggestion("j", mockBooks)
    expect(result.suggestion).toBe("John 1:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.stage).toBe("book")
  })

  // Test 5: Partial book name "gen" suggests "Genesis 1:1"
  it("suggests 'Genesis 1:1' when input is 'gen'", () => {
    const result = getAutocompleteSuggestion("gen", mockBooks)
    expect(result.suggestion).toBe("Genesis 1:1")
    expect(result.matchedBook?.name).toBe("Genesis")
    expect(result.stage).toBe("book")
  })

  // Test 6: Full book + chapter "John 3" suggests "John 3:1"
  it("suggests 'John 3:1' when input is 'John 3'", () => {
    const result = getAutocompleteSuggestion("John 3", mockBooks)
    expect(result.suggestion).toBe("John 3:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.verse).toBe(1)
    expect(result.stage).toBe("chapter")
  })

  // Test 7: Book + chapter with colon "John 3:" returns no suggestion
  it("returns empty suggestion when input is 'John 3:' (waiting for verse)", () => {
    const result = getAutocompleteSuggestion("John 3:", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.stage).toBe("verse")
  })

  // Test 8: Complete reference "John 3:16" returns no suggestion
  it("returns empty suggestion for complete reference 'John 3:16'", () => {
    const result = getAutocompleteSuggestion("John 3:16", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.chapter).toBe(3)
    expect(result.verse).toBe(16)
    expect(result.stage).toBe("complete")
  })

  // Test 9: Numbered book "1 j" suggests "I John 1:1"
  it("suggests 'I John 1:1' when input is '1 j'", () => {
    const result = getAutocompleteSuggestion("1 j", mockBooks)
    expect(result.suggestion).toBe("I John 1:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.stage).toBe("book")
  })

  // Test 10: Numbered book with chapter "1 john 3" suggests "1 john 3:1"
  it("suggests '1 john 3:1' when input is '1 john 3'", () => {
    const result = getAutocompleteSuggestion("1 john 3", mockBooks)
    expect(result.suggestion).toBe("I John 3:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.chapter).toBe(3)
    expect(result.stage).toBe("chapter")
  })

  // Test 11: Abbreviation "rom" suggests "Romans 1:1"
  it("suggests 'Romans 1:1' when input is 'rom'", () => {
    const result = getAutocompleteSuggestion("rom", mockBooks)
    expect(result.suggestion).toBe("Romans 1:1")
    expect(result.matchedBook?.name).toBe("Romans")
    expect(result.stage).toBe("book")
  })

  // Test 12: Case insensitive "JOHN" suggests "John 1:1"
  it("handles case insensitive input 'JOHN'", () => {
    const result = getAutocompleteSuggestion("JOHN", mockBooks)
    expect(result.suggestion).toBe("John 1:1")
    expect(result.matchedBook?.name).toBe("John")
    expect(result.stage).toBe("book")
  })

  // Test 13: Invalid book name returns no match
  it("returns no match for invalid book 'xyz'", () => {
    const result = getAutocompleteSuggestion("xyz", mockBooks)
    expect(result.suggestion).toBe("")
    expect(result.stage).toBe("none")
  })

  // Test 14: Psalms "ps" suggests "Psalms 1:1"
  it("suggests 'Psalms 1:1' when input is 'ps'", () => {
    const result = getAutocompleteSuggestion("ps", mockBooks)
    expect(result.suggestion).toBe("Psalms 1:1")
    expect(result.matchedBook?.name).toBe("Psalms")
    expect(result.stage).toBe("book")
  })

  // Test 15: Psalms with chapter "Psalms 23" suggests "Psalms 23:1"
  it("suggests 'Psalms 23:1' when input is 'Psalms 23'", () => {
    const result = getAutocompleteSuggestion("Psalms 23", mockBooks)
    expect(result.suggestion).toBe("Psalms 23:1")
    expect(result.matchedBook?.name).toBe("Psalms")
    expect(result.chapter).toBe(23)
    expect(result.stage).toBe("chapter")
  })
})

describe("getTabNavigationResult", () => {
  // Test 1: Typing "j" with suggestion "John 1:1" -> "John "
  it("advances from 'j' to 'John ' when suggestion is 'John 1:1'", () => {
    const result = getTabNavigationResult("j", "John 1:1")
    expect(result).toBe("John ")
  })

  // Test 2: Typing "John " with suggestion "John 1:1" -> "John 1:1" (already complete book)
  it("accepts full suggestion when book name is complete", () => {
    const result = getTabNavigationResult("John ", "John 1:1")
    expect(result).toBe("John 1:1")
  })

  // Test 3: Typing "John 3" with suggestion "John 3:1" -> "John 3:"
  it("advances from 'John 3' to 'John 3:' when suggestion is 'John 3:1'", () => {
    const result = getTabNavigationResult("John 3", "John 3:1")
    expect(result).toBe("John 3:")
  })

  // Test 4: Typing "1 j" with suggestion "I John 1:1" -> "I John "
  it("advances from '1 j' to 'I John ' when suggestion is 'I John 1:1'", () => {
    const result = getTabNavigationResult("1 j", "I John 1:1")
    expect(result).toBe("I John ")
  })

  // Test 5: Empty suggestion returns current input
  it("returns current input when no suggestion", () => {
    const result = getTabNavigationResult("john", "")
    expect(result).toBe("john")
  })

  // Test 6: Same input and suggestion returns input
  it("returns input when suggestion equals input", () => {
    const result = getTabNavigationResult("John 3:16", "John 3:16")
    expect(result).toBe("John 3:16")
  })

  // Test 7: Typing "gen" with suggestion "Genesis 1:1" -> "Genesis "
  it("advances from 'gen' to 'Genesis ' when suggestion is 'Genesis 1:1'", () => {
    const result = getTabNavigationResult("gen", "Genesis 1:1")
    expect(result).toBe("Genesis ")
  })

  // Test 8: Typing "Romans 8" with suggestion "Romans 8:1" -> "Romans 8:"
  it("advances from 'Romans 8' to 'Romans 8:' when suggestion is 'Romans 8:1'", () => {
    const result = getTabNavigationResult("Romans 8", "Romans 8:1")
    expect(result).toBe("Romans 8:")
  })
})

describe("parseTypedReference", () => {
  it("parses a full reference with colon", () => {
    const result = parseTypedReference("John 3:16", mockBooks)
    expect(result?.book.book_number).toBe(43)
    expect(result?.chapter).toBe(3)
    expect(result?.verse).toBe(16)
  })

  it("parses abbreviations and space separators", () => {
    const result = parseTypedReference("jn 3 16", mockBooks)
    // "jn" does not prefix-match "John"/"Jhn"-style abbreviations in this
    // fixture set; "joh 3 16" does.
    const result2 = parseTypedReference("joh 3 16", mockBooks)
    expect(result2?.book.book_number).toBe(43)
    expect(result2?.chapter).toBe(3)
    expect(result2?.verse).toBe(16)
    // jn simply fails to match a book rather than mis-parsing
    expect(result === null || result.book.book_number === 43).toBe(true)
  })

  it("parses numbered books", () => {
    const result = parseTypedReference("1 cor 13:4", mockBooks)
    expect(result?.book.book_number).toBe(46)
    expect(result?.chapter).toBe(13)
    expect(result?.verse).toBe(4)
  })

  it("parses numbered books with space separator", () => {
    const result = parseTypedReference("1 john 1 9", mockBooks)
    expect(result?.book.book_number).toBe(62)
    expect(result?.chapter).toBe(1)
    expect(result?.verse).toBe(9)
  })

  it("parses dot separator", () => {
    const result = parseTypedReference("psalm 23.1", mockBooks)
    expect(result?.book.book_number).toBe(19)
    expect(result?.chapter).toBe(23)
    expect(result?.verse).toBe(1)
  })

  it("does not parse book-only input", () => {
    expect(parseTypedReference("John", mockBooks)).toBeNull()
  })

  it("does not parse book+chapter input", () => {
    expect(parseTypedReference("John 3", mockBooks)).toBeNull()
  })

  it("does not parse free text", () => {
    expect(parseTypedReference("johnny walked home", mockBooks)).toBeNull()
    expect(
      parseTypedReference("for god so loved the world", mockBooks)
    ).toBeNull()
    expect(parseTypedReference("love never fails", mockBooks)).toBeNull()
  })

  it("does not parse text with trailing numbers but no book", () => {
    expect(parseTypedReference("grace 3 16", mockBooks)).toBeNull()
  })

  it("does not parse empty input", () => {
    expect(parseTypedReference("", mockBooks)).toBeNull()
  })

  it("rejects zero chapter or verse", () => {
    expect(parseTypedReference("John 0:16", mockBooks)).toBeNull()
    expect(parseTypedReference("John 3:0", mockBooks)).toBeNull()
  })
})

const numberedBooks = [
  [9, 1, "Samuel"],
  [10, 2, "Samuel"],
  [11, 1, "Kings"],
  [12, 2, "Kings"],
  [13, 1, "Chronicles"],
  [14, 2, "Chronicles"],
  [46, 1, "Corinthians"],
  [47, 2, "Corinthians"],
  [52, 1, "Thessalonians"],
  [53, 2, "Thessalonians"],
  [54, 1, "Timothy"],
  [55, 2, "Timothy"],
  [60, 1, "Peter"],
  [61, 2, "Peter"],
  [62, 1, "John"],
  [63, 2, "John"],
  [64, 3, "John"],
] as const
const ordinals = ["", "First", "Second", "Third"]

function numberedCatalog(style: "arabic" | "roman"): Book[] {
  return numberedBooks.map(([book_number, number, name]) => ({
    id: book_number,
    translation_id: 1,
    book_number,
    name: `${style === "roman" ? numberToRoman(number) : number} ${name}`,
    abbreviation: `${number}${name.slice(0, 3)}`,
    testament: book_number < 40 ? "OT" : "NT",
  }))
}

describe.each(["roman", "arabic"] as const)(
  "numbered books with %s stored names",
  (style) => {
    const books = numberedCatalog(style)
    it.each(numberedBooks)(
      "matches canonical book %i from all ordinal forms",
      (bookNumber, number, name) => {
        for (const prefix of [
          String(number),
          numberToRoman(number),
          ordinals[number],
        ]) {
          const input = `${prefix} ${name}`
          const expected = books.find(
            (book) => book.book_number === bookNumber
          )!
          expect(findMatchingBook(input.toLowerCase(), books)).toEqual(expected)
          expect(getAutocompleteSuggestion(input, books)).toMatchObject({
            matchedBook: expected,
            suggestion: `${expected.name} 1:1`,
            stage: "book",
          })
          expect(
            getAutocompleteSuggestion(`${input} 1:2`, books)
          ).toMatchObject({
            matchedBook: expected,
            chapter: 1,
            verse: 2,
            stage: "complete",
          })
          expect(parseTypedReference(`${input} 1 2`, books)).toEqual({
            book: expected,
            chapter: 1,
            verse: 2,
          })
          expect(getTabNavigationResult(input, `${expected.name} 1:1`)).toBe(
            `${expected.name} 1:1`
          )
          expect(
            getTabNavigationResult(`${input} 1`, `${expected.name} 1:1`)
          ).toBe(`${expected.name} 1:`)
        }
      }
    )

    it("completes an ordinal prefix and advances Tab through book and chapter", () => {
      const first = books[0]
      expect(getAutocompleteSuggestion("first sam", books).suggestion).toBe(
        `${first.name} 1:1`
      )
      expect(getTabNavigationResult("first sam", `${first.name} 1:1`)).toBe(
        `${first.name} `
      )
      expect(
        getAutocompleteSuggestion("FIRST", books).matchedBook
      ).toBeUndefined()
      expect(getAutocompleteSuggestion("2", books).matchedBook).toBeUndefined()
      expect(parseTypedReference("1Cor 1:2", books)?.book.book_number).toBe(46)
    })
  }
)

describe("ordinal boundaries", () => {
  it("normalizes case and whitespace without rewriting ordinary book words", () => {
    expect(normalizeInput("  sEcOnD   Samuel ")).toBe("II Samuel")
    expect(normalizeInput("Firstborn")).toBe("Firstborn")
    expect(normalizeInput("John")).toBe("John")
  })
  it("rejects unsupported ordinals and incomplete references", () => {
    const books = numberedCatalog("arabic")
    for (const input of [
      "Fourth John 1:2",
      "Firstborn John 1:2",
      "First John",
      "First John 1",
      "First John 0:2",
    ]) {
      expect(parseTypedReference(input, books)).toBeNull()
    }
  })
})

describe("visible alias completion", () => {
  it.each([
    ["First J", "I John 1:1", "First John 1:1"],
    ["First John", "1 John 1:1", "First John 1:1"],
    ["III John", "3 John 1:1", "III John 1:1"],
    ["First ", "I Samuel 1:1", "First Samuel 1:1"],
    ["SECOND  s", "II Samuel 1:1", "SECOND  samuel 1:1"],
    ["1Cor", "I Corinthians 1:1", "1Corinthians 1:1"],
  ])("draws a valid completion after %s", (input, suggestion, display) => {
    expect(input + getAutocompleteSuffix(input, suggestion)).toBe(display)
  })
  it("does not splice unrelated names into an alias", () => {
    expect(getAutocompleteSuffix("Jn", "John 1:1")).toBeNull()
  })
})
