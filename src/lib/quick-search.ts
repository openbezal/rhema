/**
 * Quick Search Utility Functions
 * Pure functions for Bible reference autocomplete logic
 */

export interface Book {
  id: number
  translation_id: number
  book_number: number
  name: string
  abbreviation: string
  testament: string
}

export interface AutocompleteResult {
  suggestion: string
  matchedBook?: Book
  chapter?: number
  verse?: number
  stage: "book" | "chapter" | "verse" | "complete" | "none"
}

/**
 * Convert number to Roman numeral for numbered books
 */
export function numberToRoman(num: number): string {
  if (num === 1) return "I"
  if (num === 2) return "II"
  if (num === 3) return "III"
  return String(num)
}

/**
 * Normalize a leading numeric or written ordinal to Roman form for matching.
 * Stored display names remain unchanged.
 */
export function normalizeInput(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ")
  const ordinal = trimmed.match(/^(first|second|third)\b\s*(.*)$/i)
  if (ordinal) {
    const number = { first: 1, second: 2, third: 3 }[ordinal[1].toLowerCase() as "first" | "second" | "third"]
    return numberToRoman(number) + (ordinal[2] ? " " + ordinal[2] : "")
  }
  const leadingNumberMatch = trimmed.match(/^(\d+)\s*(.*)$/)

  if (leadingNumberMatch) {
    const num = parseInt(leadingNumberMatch[1])
    const rest = leadingNumberMatch[2]
    return numberToRoman(num) + (rest ? " " + rest : "")
  }

  return trimmed
}

/**
 * Find matching book by name or abbreviation (case insensitive)
 */
export function findMatchingBook(bookInput: string, books: Book[]): Book | undefined {
  const normalized = normalizeInput(bookInput).toLowerCase()
  return books.find(
    b =>
      normalizeInput(b.name).toLowerCase().startsWith(normalized) ||
      normalizeInput(b.abbreviation).toLowerCase().startsWith(normalized)
  )
}

/**
 * Parse Bible reference input and return autocomplete suggestion
 */
export function getAutocompleteSuggestion(
  input: string,
  books: Book[]
): AutocompleteResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { suggestion: "", stage: "none" }
  }

  const normalizedInput = normalizeInput(trimmed)

  // An ordinal alone suggests the first installed book with that ordinal.
  if (/^(I|II|III)$/i.test(normalizedInput)) {
    const matchingBook = books.find(b => normalizeInput(b.name).toLowerCase().startsWith(normalizedInput.toLowerCase() + " "))

    if (matchingBook) {
      return {
        suggestion: matchingBook.name + " 1:1",
        matchedBook: matchingBook,
        chapter: 1,
        verse: 1,
        stage: "book"
      }
    }
  }

  // Parse: "NumberedBook Chapter:Verse" or "BookName Chapter:Verse"
  // Match patterns like: "I J", "I John", "John", "John 3", "John 3:16"
  const match = normalizedInput.match(/^([IVX]+\s+[a-zA-Z]+|[IVX]+\s+[a-zA-Z\s]+|[a-zA-Z\s]+?)\s*(\d+)?:?(\d+)?$/)

  if (!match) {
    return { suggestion: "", stage: "none" }
  }

  const bookInput = match[1].trim()
  const chapterNum = match[2]
  const verseNum = match[3]

  const matchingBook = findMatchingBook(bookInput, books)

  if (!matchingBook) {
    return { suggestion: "", stage: "none" }
  }

  // Stage 1: Autocomplete book name + suggest 1:1
  if (!chapterNum) {
    return {
      suggestion: matchingBook.name + " 1:1",
      matchedBook: matchingBook,
      chapter: 1,
      verse: 1,
      stage: "book"
    }
  }

  const chapter = parseInt(chapterNum)

  // Stage 2: Suggest colon after chapter
  if (!verseNum && !trimmed.includes(':')) {
    return {
      suggestion: trimmed + ":1",
      matchedBook: matchingBook,
      chapter,
      verse: 1,
      stage: "chapter"
    }
  }

  // Stage 3: Has colon but no verse number yet
  if (!verseNum && trimmed.includes(':')) {
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      stage: "verse"
    }
  }

  // Stage 4: Complete reference
  if (verseNum) {
    const verse = parseInt(verseNum)
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      verse,
      stage: "complete"
    }
  }

  return { suggestion: "", stage: "none" }
}

export interface TypedReference {
  book: Book
  chapter: number
  verse: number
}

/**
 * Parse a fully-typed scripture reference like "John 3:16", "jn 3 16",
 * "1 cor 13:4", or "psalm 23.1".
 *
 * Only complete book+chapter+verse references parse — book-only or
 * book+chapter input returns null (too ambiguous to pin a search result).
 * Free text like "johnny walked" never parses: the trailing numbers are
 * required and the book part must prefix-match a real book.
 */
export function parseTypedReference(
  input: string,
  books: Book[]
): TypedReference | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const normalized = normalizeInput(trimmed)
  // Book words, then chapter and verse separated by ":", ".", or whitespace.
  const match = normalized.match(
    /^([IVX]+\s+[a-zA-Z.]+|[a-zA-Z][a-zA-Z.\s]*?)\s*(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/
  )
  if (!match) return null

  const book = findMatchingBook(match[1].trim().replace(/\.$/, ""), books)
  if (!book) return null

  const chapter = parseInt(match[2])
  const verse = parseInt(match[3])
  if (chapter < 1 || verse < 1) return null

  return { book, chapter, verse }
}

/**
 * Determine what should happen when Tab/Arrow-Right is pressed
 */
export function getTabNavigationResult(
  currentInput: string,
  currentSuggestion: string
): string {
  if (!currentSuggestion || currentSuggestion === currentInput) {
    return currentInput
  }

  const trimmed = currentInput.trim()
  const suggestionTrimmed = currentSuggestion.trim()

  // Extract the full book name from the suggestion
  const bookNameMatch = suggestionTrimmed.match(/^(.+?)\s+\d+:\d+$/)

  if (bookNameMatch) {
    const fullBookName = bookNameMatch[1]

    // Check if current input matches the COMPLETE book name
    const normalizedBook = normalizeInput(fullBookName).toLowerCase()
    const normalizedCurrent = normalizeInput(trimmed).toLowerCase()
    const currentIsCompleteBookName = normalizedCurrent === normalizedBook

    // Check if current input has a chapter number
    const hasChapter =
      new RegExp(`^${normalizedBook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+`, 'i').test(normalizedCurrent) &&
      !trimmed.includes(':')

    // Stage 1: Still typing book name -> advance to complete book name
    if (!currentIsCompleteBookName && !hasChapter) {
      return fullBookName + " "
    }

    // Stage 2: Has chapter -> advance to chapter with colon
    if (hasChapter) {
      const chapterMatch = suggestionTrimmed.match(/^(.+\s+\d+):\d+$/)
      if (chapterMatch) {
        return chapterMatch[1] + ":"
      }
    }
  }

  // Default: accept full suggestion
  return currentSuggestion
}

/** Text drawn after the typed alias in the autocomplete overlay. */
export function getAutocompleteSuffix(input: string, suggestion: string): string | null {
  const normalized = normalizeInput(input).toLowerCase()
  if (!normalized) return null
  // Find the equivalent prefix in the stored spelling; its length can differ
  // from the typed alias ("First J" versus "I J" or "1 J").
  for (let end = 1; end <= suggestion.length; end++) {
    if (normalizeInput(suggestion.slice(0, end)).toLowerCase() === normalized) {
      const suffix = suggestion.slice(end)
      return /\s$/.test(input) ? suffix.trimStart() : suffix
    }
  }
  return null
}
