import { create } from "zustand"
import type { QueueItem } from "@/types"

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null
  /** Changes even when the operator selects the same row again. */
  selectionRevision: number
  /** ID of the queue item currently being flash-highlighted (null = none). */
  highlightedId: string | null

  addItem: (item: QueueItem) => void
  removeItem: (id: string) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void
  /** Flash-highlight a queue item briefly (1.5 s). */
  flashItem: (id: string) => void
  /** Find an existing item by book+chapter+verse. Returns its index or -1. */
  findDuplicate: (bookNumber: number, chapter: number, verse: number) => number
  /** Fill in verse text on an item that was queued without it. Never overwrites non-empty text. */
  backfillText: (id: string, text: string) => void
  /** Update a chapter-only queue item in place when the verse is refined. */
  updateEarlyRef: (
    bookNumber: number,
    chapter: number,
    verse: number,
    reference: string,
    verseText: string,
    attribution?: { translationId: number; translationCode: string }
  ) => boolean
}

let flashTimer: ReturnType<typeof setTimeout> | null = null

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  activeIndex: null,
  selectionRevision: 0,
  highlightedId: null,

  addItem: (item) =>
    set((state) => {
      const idx = state.items.findIndex(
        (i) =>
          i.verse.book_number === item.verse.book_number &&
          i.verse.chapter === item.verse.chapter &&
          i.verse.verse === item.verse.verse
      )
      if (idx !== -1) {
        // Duplicate: don't re-add, but backfill text if the existing item
        // was queued without it (detections can arrive with empty text).
        const existing = state.items[idx]
        if (
          existing.verse.translation_id === item.verse.translation_id &&
          !existing.verse.text &&
          item.verse.text
        ) {
          const items = [...state.items]
          items[idx] = {
            ...existing,
            verse: { ...existing.verse, text: item.verse.text },
          }
          return { items }
        }
        return state
      }
      return {
        items: [item, ...state.items],
        activeIndex: state.activeIndex === null ? null : state.activeIndex + 1,
      }
    }),
  removeItem: (id) =>
    set((state) => {
      const selectedId =
        state.activeIndex === null ? null : state.items[state.activeIndex]?.id
      const items = state.items.filter((item) => item.id !== id)
      const index = selectedId
        ? items.findIndex((item) => item.id === selectedId)
        : -1
      return {
        items,
        activeIndex: index < 0 ? null : index,
        highlightedId: state.highlightedId === id ? null : state.highlightedId,
      }
    }),
  reorderItems: (fromIndex, toIndex) =>
    set((state) => {
      if (
        !Number.isInteger(fromIndex) ||
        !Number.isInteger(toIndex) ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.items.length ||
        toIndex >= state.items.length
      )
        return state
      const selectedId =
        state.activeIndex === null ? null : state.items[state.activeIndex]?.id
      const items = [...state.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      const index = selectedId
        ? items.findIndex((item) => item.id === selectedId)
        : -1
      return { items, activeIndex: index < 0 ? null : index }
    }),
  setActive: (activeIndex) =>
    set((state) => ({
      activeIndex,
      selectionRevision: state.selectionRevision + 1,
    })),
  clearQueue: () =>
    set((state) => ({
      items: [],
      activeIndex: null,
      selectionRevision: state.selectionRevision + 1,
    })),
  flashItem: (id) => {
    if (flashTimer) clearTimeout(flashTimer)
    set({ highlightedId: id })
    flashTimer = setTimeout(() => set({ highlightedId: null }), 1500)
  },
  findDuplicate: (bookNumber, chapter, verse) =>
    get().items.findIndex(
      (i) =>
        i.verse.book_number === bookNumber &&
        i.verse.chapter === chapter &&
        i.verse.verse === verse
    ),
  backfillText: (id, text) =>
    set((state) => {
      const idx = state.items.findIndex((i) => i.id === id)
      if (idx === -1 || state.items[idx].verse.text || !text) return state
      const items = [...state.items]
      items[idx] = {
        ...items[idx],
        verse: { ...items[idx].verse, text },
      }
      return { items }
    }),
  updateEarlyRef: (
    bookNumber,
    chapter,
    verse,
    reference,
    verseText,
    attribution
  ) => {
    let found = false
    set((state) => {
      // First try exact match: same book + same chapter
      let idx = state.items.findIndex(
        (i) =>
          i.is_chapter_only &&
          (!attribution ||
            i.verse.translation_id === attribution.translationId) &&
          i.verse.book_number === bookNumber &&
          i.verse.chapter === chapter
      )
      // Fallback: same book, any chapter (book-only detection guessed chapter 1)
      if (idx === -1) {
        idx = state.items.findIndex(
          (i) =>
            i.is_chapter_only &&
            (!attribution ||
              i.verse.translation_id === attribution.translationId) &&
            i.verse.book_number === bookNumber
        )
      }
      if (idx === -1) return state
      found = true
      const destination = state.items.find(
        (item, index) =>
          index !== idx &&
          item.verse.book_number === bookNumber &&
          item.verse.chapter === chapter &&
          item.verse.verse === verse
      )
      if (destination) {
        // The saved canonical entry keeps its source/text. Remove the redundant
        // placeholder while retaining selection and highlight by item identity.
        const redundant = state.items[idx]
        const items = state.items.filter((item) => item.id !== redundant.id)
        const selectedId =
          state.activeIndex === null ? null : state.items[state.activeIndex]?.id
        const selected =
          selectedId === redundant.id ? destination.id : selectedId
        const activeIndex = selected
          ? items.findIndex((item) => item.id === selected)
          : -1
        return {
          items,
          activeIndex: activeIndex < 0 ? null : activeIndex,
          highlightedId:
            state.highlightedId === redundant.id
              ? destination.id
              : state.highlightedId,
        }
      }
      const items = [...state.items]
      const item = { ...items[idx] }
      item.verse = { ...item.verse, chapter, verse, text: verseText }
      if (attribution) item.translation_code = attribution.translationCode
      item.reference = reference
      item.is_chapter_only = false
      items[idx] = item
      return { items }
    })
    return found
  },
}))
