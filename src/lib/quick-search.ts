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
  const trimmed = input.normalize("NFC").trim().replace(/\s+/g, " ")
  const ordinal = trimmed.match(/^(first|second|third)\b\s*(.*)$/i)
  if (ordinal) {
    const number = { first: 1, second: 2, third: 3 }[
      ordinal[1].toLowerCase() as "first" | "second" | "third"
    ]
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
export function findMatchingBook(
  bookInput: string,
  books: Book[]
): Book | undefined {
  const normalized = normalizeInput(bookInput).replace(/\.$/, "").toLowerCase()
  if (!normalized) return undefined
  const labels = (book: Book) =>
    [book.name, book.abbreviation].map((label) =>
      normalizeInput(label).toLowerCase()
    )
  const exact = books.filter((book) => labels(book).includes(normalized))
  const prefix = /^(i|ii|iii)$/.test(normalized) ? normalized + " " : normalized
  const matches = exact.length
    ? exact
    : books.filter((book) =>
        labels(book).some((label) => label.startsWith(prefix))
      )
  return new Set(matches.map((book) => book.book_number)).size === 1
    ? matches[0]
    : undefined
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

  // Installed Unicode labels, then optional chapter and a colon, dot or space
  // before the verse. Numbered-book aliases were normalized above.
  const match = normalizedInput.match(
    /^([\p{L}\p{M}][\p{L}\p{M}\s.'’-]*?)\s*(?:(\d+)(?:(\s*[:.]\s*|\s+)(\d*))?)?$/u
  )

  if (!match) {
    return { suggestion: "", stage: "none" }
  }

  const bookInput = match[1].trim()
  const chapterNum = match[2]
  const delimiter = match[3]
  const verseNum = match[4]

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
      stage: "book",
    }
  }

  const chapter = parseInt(chapterNum)
  if (!Number.isSafeInteger(chapter) || chapter < 1)
    return { suggestion: "", stage: "none" }

  // Stage 2: Suggest colon after chapter
  if (!delimiter) {
    return {
      suggestion: `${matchingBook.name} ${chapter}:1`,
      matchedBook: matchingBook,
      chapter,
      verse: 1,
      stage: "chapter",
    }
  }

  // Stage 3: Has colon but no verse number yet
  if (!verseNum) {
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      stage: "verse",
    }
  }

  // Stage 4: Complete reference
  if (verseNum) {
    const verse = parseInt(verseNum)
    if (!Number.isSafeInteger(verse) || verse < 1)
      return { suggestion: "", stage: "none" }
    return {
      suggestion: "",
      matchedBook: matchingBook,
      chapter,
      verse,
      stage: "complete",
    }
  }

  return { suggestion: "", stage: "none" }
}

export interface TypedReference {
  book: Book
  chapter: number
  verse: number
}

/** Complete only an explicit delimiter or a complete reference. Callers keep
 * deletion, mid-input editing and IME composition as the operator typed them. */
export function completeTypedReferenceInput(
  input: string,
  books: Book[]
): string {
  const parsed = getAutocompleteSuggestion(input, books)
  if (!parsed.matchedBook) return input
  const name = parsed.matchedBook.name
  if (parsed.stage === "book" && /\s$/.test(input)) return `${name} `
  if (
    (parsed.stage === "chapter" && /\s$/.test(input)) ||
    parsed.stage === "verse"
  )
    return `${name} ${parsed.chapter}:`
  if (parsed.stage === "complete")
    return `${name} ${parsed.chapter}:${parsed.verse}`
  return input
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
  const parsed = getAutocompleteSuggestion(input, books)
  return parsed.stage === "complete" &&
    parsed.matchedBook &&
    parsed.chapter &&
    parsed.verse
    ? { book: parsed.matchedBook, chapter: parsed.chapter, verse: parsed.verse }
    : null
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
    const hasChapter = /\d+$/.test(normalizedCurrent) && !/[.:]/.test(trimmed)

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
export function getAutocompleteSuffix(
  input: string,
  suggestion: string
): string | null {
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
