import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import { invoke } from "@tauri-apps/api/core"
import type { Translation, Book, Verse, CrossReference } from "@/types"
import type { SemanticSearchResult } from "@/types/detection"

interface PendingNavigation {
  bookNumber: number
  chapter: number
  verse: number
  /**
   * Present the verse to the live output once navigation lands. Set only by
   * manual operator actions (quick search); detections leave it unset so the
   * Auto toggle stays the sole gate for detection-driven presents.
   */
  present?: boolean
}

interface BibleState {
  translations: Translation[]
  activeTranslationId: number
  secondaryTranslationId: number | null
  books: Book[]
  searchResults: Verse[]
  semanticResults: SemanticSearchResult[]
  selectedVerse: Verse | null
  currentChapter: Verse[]
  crossReferences: CrossReference[]
  pendingNavigation: PendingNavigation | null
  /**
   * Incremented to ask the Bible panel to scroll the selected verse into view.
   * A counter rather than a flag: two identical consecutive requests must both
   * fire, and a primitive keeps the panel's effect dependency simple.
   *
   * Only navigation requests a reveal. A plain `selectVerse` — which
   * `presentVerse` calls on every auto-live detection — must not move the
   * operator's scroll position mid-service.
   */
  revealRequest: number
  revealBlock: ScrollLogicalPosition

  setTranslations: (translations: Translation[]) => void
  setActiveTranslation: (id: number) => void
  setSecondaryTranslation: (id: number | null) => void
  setBooks: (books: Book[]) => void
  setSearchResults: (results: Verse[]) => void
  setSemanticResults: (results: SemanticSearchResult[]) => void
  selectVerse: (verse: Verse | null) => void
  setCurrentChapter: (verses: Verse[]) => void
  setCrossReferences: (refs: CrossReference[]) => void
  setPendingNavigation: (nav: PendingNavigation | null) => void
  requestVerseReveal: (block: ScrollLogicalPosition) => void
}

export const useBibleStore = create<BibleState>((set) => ({
  translations: [],
  activeTranslationId: 1, // KJV default
  secondaryTranslationId: null,
  books: [],
  searchResults: [],
  semanticResults: [],
  selectedVerse: null,
  currentChapter: [],
  crossReferences: [],
  pendingNavigation: null,
  revealRequest: 0,
  revealBlock: "nearest",

  setTranslations: (translations) => set({ translations }),
  setActiveTranslation: (activeTranslationId) =>
    set((state) => ({
      activeTranslationId,
      secondaryTranslationId:
        state.secondaryTranslationId === activeTranslationId
          ? null
          : state.secondaryTranslationId,
    })),
  setSecondaryTranslation: (secondaryTranslationId) =>
    set((state) => ({
      secondaryTranslationId:
        secondaryTranslationId === state.activeTranslationId
          ? null
          : secondaryTranslationId,
    })),
  setBooks: (books) => set({ books }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setSemanticResults: (semanticResults) => set({ semanticResults }),
  selectVerse: (selectedVerse) => set({ selectedVerse }),
  setCurrentChapter: (currentChapter) => set({ currentChapter }),
  setCrossReferences: (crossReferences) => set({ crossReferences }),
  setPendingNavigation: (pendingNavigation) => set({ pendingNavigation }),
  requestVerseReveal: (revealBlock) =>
    set((s) => ({ revealRequest: s.revealRequest + 1, revealBlock })),
}))

/** Load persisted translation selections from disk into Zustand, then sync the primary to Rust. */
export async function hydrateBibleStore(): Promise<void> {
  try {
    const store = await load("bible.json", { autoSave: false, defaults: {} })
    const [activeValue, secondaryValue] = await Promise.all([
      store.get<number>("activeTranslationId"),
      store.get<number | null>("secondaryTranslationId"),
    ])
    const activeTranslationId =
      typeof activeValue === "number"
        ? activeValue
        : useBibleStore.getState().activeTranslationId
    useBibleStore.getState().setActiveTranslation(activeTranslationId)
    useBibleStore
      .getState()
      .setSecondaryTranslation(
        typeof secondaryValue === "number" &&
          secondaryValue !== activeTranslationId
          ? secondaryValue
          : null
      )
    await invoke("set_active_translation", {
      translationId: useBibleStore.getState().activeTranslationId,
    })
  } catch {
    console.warn("[bible] Failed to hydrate bible store, using defaults")
  }
}

/** Subscribe to translation selection changes and persist them with debounce. */
export async function initBiblePersistence(): Promise<void> {
  try {
    const store = await load("bible.json", { autoSave: false, defaults: {} })
    let timer: ReturnType<typeof setTimeout> | null = null
    let prev = {
      activeTranslationId: useBibleStore.getState().activeTranslationId,
      secondaryTranslationId: useBibleStore.getState().secondaryTranslationId,
    }

    useBibleStore.subscribe((state) => {
      if (
        state.activeTranslationId === prev.activeTranslationId &&
        state.secondaryTranslationId === prev.secondaryTranslationId
      ) {
        return
      }
      prev = {
        activeTranslationId: state.activeTranslationId,
        secondaryTranslationId: state.secondaryTranslationId,
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        const current = useBibleStore.getState()
        await store.set("activeTranslationId", current.activeTranslationId)
        await store.set(
          "secondaryTranslationId",
          current.secondaryTranslationId
        )
        await store.save()
      }, 500)
    })
  } catch {
    console.warn("[bible] Failed to init persistence subscription")
  }
}
