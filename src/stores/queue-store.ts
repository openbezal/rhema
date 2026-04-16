import { create } from "zustand"
import type { QueueItem } from "@/types"

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null
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
  /** Update a chapter-only queue item in place when the verse is refined. */
  updateEarlyRef: (bookNumber: number, chapter: number, verse: number, reference: string, verseText: string) => boolean
}

let flashTimer: ReturnType<typeof setTimeout> | null = null

export const useQueueStore = create<QueueState>((set, get) => ({
  items: [],
  activeIndex: null,
  highlightedId: null,

  addItem: (item) =>
    set((state) => {
      const duplicate = state.items.some(
        (i) =>
          i.verse.book_number === item.verse.book_number &&
          i.verse.chapter === item.verse.chapter &&
          i.verse.verse === item.verse.verse,
      )
      if (duplicate) return state
      return { items: [item, ...state.items] }
    }),
  removeItem: (id) =>
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    })),
  reorderItems: (fromIndex, toIndex) =>
    set((state) => {
      const items = [...state.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      return { items }
    }),
  setActive: (activeIndex) => set({ activeIndex }),
  clearQueue: () => set({ items: [], activeIndex: null }),
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
        i.verse.verse === verse,
    ),
  updateEarlyRef: (bookNumber, chapter, verse, reference, verseText) => {
    let found = false
    set((state) => {
      // First try exact match: same book + same chapter
      let idx = state.items.findIndex(
        (i) =>
          i.is_chapter_only &&
          i.verse.book_number === bookNumber &&
          i.verse.chapter === chapter,
      )
      // Fallback: same book, any chapter (book-only detection guessed chapter 1)
      if (idx === -1) {
        idx = state.items.findIndex(
          (i) =>
            i.is_chapter_only &&
            i.verse.book_number === bookNumber,
        )
      }
      if (idx === -1) return state
      found = true
      const items = [...state.items]
      const item = { ...items[idx] }
      item.verse = { ...item.verse, verse, text: verseText }
      item.reference = reference
      item.is_chapter_only = false
      items[idx] = item
      return { items }
    })
    return found
  },
}))
