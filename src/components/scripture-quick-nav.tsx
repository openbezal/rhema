import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useBibleStore } from "@/stores"
import type { Book, Verse } from "@/types"

/**
 * EasyWorship-style scripture quick navigation.
 * Type "J" -> autocompletes to "John", press → or Tab to accept
 * Type chapter number -> shows verses
 * Type verse number -> navigates to verse
 *
 * Format: BookName Chapter:Verse (e.g., "John 3:16")
 */
export function ScriptureQuickNav({ onNavigate }: { onNavigate?: () => void }) {
  const [input, setInput] = useState("")
  const [books, setBooks] = useState<Book[]>([])
  const [suggestion, setSuggestion] = useState("")
  const [showVerses, setShowVerses] = useState(false)
  const [verses, setVerses] = useState<Verse[]>([])
  const [currentBook, setCurrentBook] = useState<Book | null>(null)
  const [currentChapter, setCurrentChapter] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load books on mount
  useEffect(() => {
    invoke<Book[]>("list_books").then(setBooks).catch(console.error)
  }, [])

  // Parse input and provide autocomplete
  useEffect(() => {
    const trimmed = input.trim()

    if (!trimmed) {
      setSuggestion("")
      setShowVerses(false)
      setCurrentBook(null)
      setCurrentChapter(null)
      return
    }

    // Check if input matches "BookName Chapter:Verse" pattern
    const match = trimmed.match(/^([a-zA-Z\s]+)\s*(\d+)?:?(\d+)?$/)

    if (!match) {
      setSuggestion("")
      setShowVerses(false)
      return
    }

    const bookInput = match[1].trim().toLowerCase()
    const chapterInput = match[2]
    const verseInput = match[3]

    // Find matching book
    const matchingBook = books.find(
      b =>
        b.name.toLowerCase().startsWith(bookInput) ||
        b.abbreviation.toLowerCase().startsWith(bookInput)
    )

    if (!matchingBook) {
      setSuggestion("")
      setShowVerses(false)
      setCurrentBook(null)
      return
    }

    setCurrentBook(matchingBook)

    // Autocomplete book name
    if (!chapterInput) {
      const remainder = matchingBook.name.slice(bookInput.length)
      setSuggestion(trimmed + remainder)
      setShowVerses(false)
      return
    }

    // Chapter specified
    const chapter = parseInt(chapterInput)
    setCurrentChapter(chapter)

    // If verse not specified yet, suggest colon
    if (!verseInput && !trimmed.includes(':')) {
      setSuggestion(trimmed + ':')
      // Load verses for this chapter
      loadChapterVerses(matchingBook.book_number, chapter)
      return
    }

    // Verse specified
    if (verseInput) {
      setSuggestion("")
      setShowVerses(false)
    } else {
      // Just colon, show verses
      loadChapterVerses(matchingBook.book_number, chapter)
    }
  }, [input, books])

  const loadChapterVerses = useCallback(async (bookNumber: number, chapter: number) => {
    try {
      const activeTranslationId = useBibleStore.getState().activeTranslationId
      const result = await invoke<Verse[]>("get_chapter", {
        translationId: activeTranslationId,
        bookNumber,
        chapter
      })
      setVerses(result)
      setShowVerses(true)
    } catch (error) {
      console.error("Failed to load verses:", error)
      setVerses([])
      setShowVerses(false)
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Accept suggestion with → or Tab
    if ((e.key === "ArrowRight" || e.key === "Tab") && suggestion && suggestion !== input) {
      e.preventDefault()
      setInput(suggestion)
      return
    }

    // Navigate to verse on Enter
    if (e.key === "Enter") {
      e.preventDefault()
      navigateToVerse()
      return
    }

    // Navigate verse list with arrow keys when verses are shown
    if (showVerses && verses.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        // Implement verse navigation if needed
      }
    }
  }

  const navigateToVerse = () => {
    const match = input.match(/^([a-zA-Z\s]+)\s*(\d+):(\d+)$/)
    if (!match || !currentBook) return

    const chapter = parseInt(match[2])
    const verse = parseInt(match[3])

    // Set pending navigation in store
    useBibleStore.getState().setPendingNavigation({
      bookNumber: currentBook.book_number,
      chapter,
      verse
    })

    // Clear input
    setInput("")
    setSuggestion("")
    setShowVerses(false)

    if (onNavigate) onNavigate()
  }

  const handleVerseClick = (verse: Verse) => {
    useBibleStore.getState().setPendingNavigation({
      bookNumber: verse.book_number,
      chapter: verse.chapter,
      verse: verse.verse
    })

    setInput("")
    setSuggestion("")
    setShowVerses(false)

    if (onNavigate) onNavigate()
  }

  return (
    <div className="relative">
      <div className="relative">
        {/* Suggestion overlay */}
        {suggestion && suggestion !== input && (
          <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
            <span className="text-xs text-muted-foreground/40">
              {suggestion}
            </span>
          </div>
        )}

        {/* Actual input */}
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type book name... (e.g., J → John 3:16)"
          className="h-8 text-xs relative bg-background"
        />
      </div>

      {/* Verse dropdown */}
      {showVerses && verses.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          <div className="p-1">
            {verses.map((verse) => (
              <button
                key={verse.id}
                onClick={() => handleVerseClick(verse)}
                className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <span className="shrink-0 font-semibold text-primary w-6 text-right">
                  {verse.verse}
                </span>
                <span className="flex-1 text-muted-foreground line-clamp-1">
                  {verse.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
