import { create } from "zustand"
import type { QueueItem } from "@/types"

interface QueueState {
  items: QueueItem[]
  activeIndex: number | null

  addItem: (item: QueueItem) => void
  removeItem: (id: string) => void
  reorderItems: (fromIndex: number, toIndex: number) => void
  setActive: (index: number | null) => void
  clearQueue: () => void
  /** Update a chapter-only queue item in place when the verse is refined. */
  updateEarlyRef: (bookNumber: number, chapter: number, verse: number, reference: string, verseText: string) => boolean
}

export const useQueueStore = create<QueueState>((set) => ({
  items: [],
  activeIndex: null,

  addItem: (item) =>
    set((state) => ({ items: [item, ...state.items] })),
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
  updateEarlyRef: (bookNumber, chapter, verse, reference, verseText) => {
    let found = false
    set((state) => {
      const idx = state.items.findIndex(
        (i) =>
          i.is_chapter_only &&
          i.verse.book_number === bookNumber &&
          i.verse.chapter === chapter,
      )
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
