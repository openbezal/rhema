import { describe, expect, it } from "vitest"
import {
  numberToRoman,
  normalizeInput,
  findMatchingBook,
  getAutocompleteSuggestion,
  getTabNavigationResult,
  type Book,
} from "./quick-search"

// Mock book data
const mockBooks: Book[] = [
  { id: 1, translation_id: 1, book_number: 1, name: "Genesis", abbreviation: "Gen", testament: "OT" },
  { id: 43, translation_id: 1, book_number: 43, name: "John", abbreviation: "John", testament: "NT" },
  { id: 62, translation_id: 1, book_number: 62, name: "I John", abbreviation: "1John", testament: "NT" },
  { id: 63, translation_id: 1, book_number: 63, name: "II John", abbreviation: "2John", testament: "NT" },
  { id: 64, translation_id: 1, book_number: 64, name: "III John", abbreviation: "3John", testament: "NT" },
  { id: 45, translation_id: 1, book_number: 45, name: "Romans", abbreviation: "Rom", testament: "NT" },
  { id: 19, translation_id: 1, book_number: 19, name: "Psalms", abbreviation: "Ps", testament: "OT" },
  { id: 46, translation_id: 1, book_number: 46, name: "I Corinthians", abbreviation: "1Cor", testament: "NT" },
]

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
  it("suggests 'I John 1:1' when input is '1'", () => {
    const result = getAutocompleteSuggestion("1", mockBooks)
    expect(result.suggestion).toBe("I John 1:1")
    expect(result.matchedBook?.name).toBe("I John")
    expect(result.chapter).toBe(1)
    expect(result.verse).toBe(1)
    expect(result.stage).toBe("book")
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
    expect(result.suggestion).toBe("1 john 3:1")
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
