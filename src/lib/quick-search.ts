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
 * Normalize input: convert leading numbers to Roman numerals for matching
 * Examples: "1 S" -> "I S", "2 C" -> "II C", "3 J" -> "III J"
 */
export function normalizeInput(input: string): string {
  const trimmed = input.trim()
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
  const normalized = bookInput.toLowerCase()
  return books.find(
    b =>
      b.name.toLowerCase().startsWith(normalized) ||
      b.abbreviation.toLowerCase().startsWith(normalized)
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

  // Check if it's just a number (for numbered books like "1", "2", "3")
  if (/^\d+$/.test(trimmed)) {
    const matchingBook = books.find(b => b.name.startsWith(normalizedInput + " "))

    if (matchingBook) {
      const remainder = matchingBook.name.slice(normalizedInput.length)
      return {
        suggestion: normalizedInput + remainder + " 1:1",
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
  const bookNameMatch = suggestionTrimmed.match(/^(([IVX]+\s+)?[a-zA-Z\s]+)\s+\d+:\d+$/)

  if (bookNameMatch) {
    const fullBookName = bookNameMatch[1]

    // Check if current input matches the COMPLETE book name
    const currentIsCompleteBookName =
      trimmed === fullBookName + " " || trimmed === fullBookName

    // Check if current input has a chapter number
    const hasChapter =
      new RegExp(`^${fullBookName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+`, 'i').test(trimmed) &&
      !trimmed.includes(':')

    // Stage 1: Still typing book name -> advance to complete book name
    if (!currentIsCompleteBookName && !hasChapter) {
      return fullBookName + " "
    }

    // Stage 2: Has chapter -> advance to chapter with colon
    if (hasChapter) {
      const chapterMatch = suggestionTrimmed.match(/^(([IVX]+\s+)?[a-zA-Z\s]+\s+\d+):\d+$/)
      if (chapterMatch) {
        return chapterMatch[1] + ":"
      }
    }
  }

  // Default: accept full suggestion
  return currentSuggestion
}
