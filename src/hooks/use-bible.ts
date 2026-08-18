import { invoke } from "@tauri-apps/api/core"
import { useBibleStore } from "@/stores"
import { presentVerse } from "@/hooks/use-broadcast"
import type { Translation, Book, Verse, CrossReference } from "@/types"
import type { SemanticSearchResult } from "@/types/detection"

// Stable action functions that use getState() instead of closing over the store.
// This prevents the infinite re-render loop caused by useCallback deps changing every render.

async function loadTranslations() {
  const translations = await invoke<Translation[]>("list_translations")
  useBibleStore.getState().setTranslations(translations)
  return translations
}

async function loadBooks(translationId?: number) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  const books = await invoke<Book[]>("list_books", { translationId: id })
  useBibleStore.getState().setBooks(books)
  return books
}

/**
 * Read a chapter without touching the store. A chapter that does not exist
 * comes back as an empty array, never an error, which makes this the probe
 * used to test a chapter boundary — `loadChapter` would blank the panel it is
 * being asked to protect.
 */
export async function fetchChapter(
  bookNumber: number,
  chapter: number,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  return invoke<Verse[]>("get_chapter", {
    translationId: id,
    bookNumber,
    chapter,
  })
}

async function loadChapter(
  bookNumber: number,
  chapter: number,
  translationId?: number
) {
  const verses = await fetchChapter(bookNumber, chapter, translationId)
  useBibleStore.getState().setCurrentChapter(verses)
  return verses
}

async function fetchVerse(
  bookNumber: number,
  chapter: number,
  verse: number,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  return invoke<Verse | null>("get_verse", {
    translationId: id,
    bookNumber,
    chapter,
    verse,
  })
}

async function searchVerses(
  query: string,
  limit = 20,
  translationId?: number
) {
  const id = translationId ?? useBibleStore.getState().activeTranslationId
  const results = await invoke<Verse[]>("search_verses", {
    query,
    translationId: id,
    limit,
  })
  useBibleStore.getState().setSearchResults(results)
  return results
}

async function semanticSearch(query: string, limit = 10) {
  const results = await invoke<SemanticSearchResult[]>("semantic_search", {
    query,
    limit,
  })
  useBibleStore.getState().setSemanticResults(results)
  return results
}

async function loadCrossReferences(
  bookNumber: number,
  chapter: number,
  verse: number
) {
  const refs = await invoke<CrossReference[]>("get_cross_references", {
    bookNumber,
    chapter,
    verse,
  })
  useBibleStore.getState().setCrossReferences(refs)
  return refs
}

interface VerseCoordinates {
  bookNumber: number
  chapter: number
  verse: number
}

/**
 * Find a verse in a loaded chapter by its coordinates.
 *
 * Matching on book/chapter/verse rather than `Verse.id` is what keeps a
 * selection meaningful across a translation switch, where ids change, and what
 * drops the selection when the panel moves to a different chapter.
 */
export function findLoadedVerse(
  chapterVerses: Verse[],
  target: VerseCoordinates | null
): Verse | null {
  if (!target) return null
  return (
    chapterVerses.find(
      (v) =>
        v.book_number === target.bookNumber &&
        v.chapter === target.chapter &&
        v.verse === target.verse
    ) ?? null
  )
}

function coordinatesOf(verse: Verse): VerseCoordinates {
  return {
    bookNumber: verse.book_number,
    chapter: verse.chapter,
    verse: verse.verse,
  }
}

// Monotonic ticket so an older step whose chapter probe resolves late can't
// overwrite a newer one (a held controller button steps in quick succession).
let stepSeq = 0

/**
 * Move the Bible panel's selection one verse in `direction`.
 *
 * Shared by the panel's arrow keys, the OSC/HTTP `bible_next` and `bible_prev`
 * commands, and (from Phase 2) the bracket shortcuts, so the surfaces cannot
 * drift apart.
 *
 * A target already in the loaded chapter is selected synchronously. Anything
 * else — a chapter boundary, or a verse picked from a context search in a
 * chapter the panel never loaded — goes through `pendingNavigation`, the
 * panel's existing load-then-select path.
 *
 * Both boundary directions probe before navigating, and the probe never writes
 * the store: the end of a book, the start of Genesis, and a chapter missing
 * from the active translation all resolve to doing nothing at all, leaving the
 * panel showing exactly what it was showing.
 *
 * `options.present` sends the landed verse to the live output. The panel's
 * arrow keys pass it; the remote `bible_next` / `bible_prev` commands don't —
 * they stay preview-only, with the remote's `send_to_live` as the commit.
 */
export async function stepVerse(
  direction: "next" | "prev",
  options?: { present?: boolean }
): Promise<void> {
  // Claim the ticket before anything else. A step that resolves synchronously
  // still has to invalidate a crossing already in flight, or the operator's
  // correction lands and the crossing it replaced arrives afterwards.
  stepSeq += 1
  const ticket = stepSeq

  const state = useBibleStore.getState()
  const offset = direction === "next" ? 1 : -1

  const cursor =
    state.pendingNavigation ??
    (state.selectedVerse ? coordinatesOf(state.selectedVerse) : null)

  // Nothing selected yet: enter the loaded chapter from the end the operator
  // is stepping away from.
  if (!cursor) {
    const entry =
      direction === "next"
        ? state.currentChapter[0]
        : state.currentChapter[state.currentChapter.length - 1]
    if (!entry) return
    state.selectVerse(entry)
    if (options?.present) void presentVerse(entry)
    state.requestVerseReveal("nearest")
    return
  }

  const target = { ...cursor, verse: cursor.verse + offset }

  if (!state.pendingNavigation) {
    const loaded = findLoadedVerse(state.currentChapter, target)
    if (loaded) {
      state.selectVerse(loaded)
      if (options?.present) void presentVerse(loaded)
      state.requestVerseReveal("nearest")
      return
    }
  }

  try {
    const cursorChapter = await resolveChapter(state.currentChapter, cursor)
    if (ticket !== stepSeq) return

    if (cursorChapter.some((v) => v.verse === target.verse)) {
      useBibleStore.getState().setPendingNavigation({ ...target, present: options?.present })
      return
    }

    const crossingChapter = cursor.chapter + offset
    if (crossingChapter < 1) return

    const crossing = await fetchChapter(cursor.bookNumber, crossingChapter)
    if (ticket !== stepSeq) return
    if (crossing.length === 0) return

    const landing = direction === "next" ? crossing[0] : crossing[crossing.length - 1]
    useBibleStore.getState().setPendingNavigation({
      bookNumber: cursor.bookNumber,
      chapter: crossingChapter,
      verse: landing.verse,
      present: options?.present,
    })
  } catch (e) {
    console.warn("[bible] stepVerse chapter lookup failed:", e)
  }
}

async function resolveChapter(
  currentChapter: Verse[],
  cursor: VerseCoordinates
): Promise<Verse[]> {
  const loaded = currentChapter[0]
  if (
    loaded &&
    loaded.book_number === cursor.bookNumber &&
    loaded.chapter === cursor.chapter
  ) {
    return currentChapter
  }
  return fetchChapter(cursor.bookNumber, cursor.chapter)
}

// Exported stable references — these never change between renders
export const bibleActions = {
  loadTranslations,
  loadBooks,
  loadChapter,
  fetchChapter,
  findLoadedVerse,
  stepVerse,
  fetchVerse,
  searchVerses,
  semanticSearch,
  loadCrossReferences,
  navigateToVerse: (bookNumber: number, chapter: number, verse: number) =>
    useBibleStore
      .getState()
      .setPendingNavigation({ bookNumber, chapter, verse }),
  selectVerse: (verse: Verse | null) =>
    useBibleStore.getState().selectVerse(verse),
}

// Hook for components that need reactive store data
export function useBible() {
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const books = useBibleStore((s) => s.books)
  const currentChapter = useBibleStore((s) => s.currentChapter)
  const searchResults = useBibleStore((s) => s.searchResults)
  const semanticResults = useBibleStore((s) => s.semanticResults)
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const crossReferences = useBibleStore((s) => s.crossReferences)

  return {
    translations,
    activeTranslationId,
    books,
    currentChapter,
    searchResults,
    semanticResults,
    selectedVerse,
    crossReferences,
    ...bibleActions,
  }
}
