import { resolveTranslationSelection, saveTranslationSelection, translationCode, type TranslationSelectionStatus } from "@/lib/translation-selection"
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
  /** Reserved before a manual step performs asynchronous chapter probes. */
  presentationRevision?: number
  /** Detection-owned navigation is cancelled when Follow is disabled. */
  follow?: boolean
}

interface BibleState {
  followDetections: boolean
  followRevision: number
  setFollowDetections: (enabled: boolean) => void
  translations: Translation[]
  activeTranslationId: number
  activeTranslationCode: string | null
  translationSelectionStatus: TranslationSelectionStatus
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
  setBooks: (books: Book[]) => void
  setSearchResults: (results: Verse[]) => void
  setSemanticResults: (results: SemanticSearchResult[]) => void
  selectVerse: (verse: Verse | null) => void
  setCurrentChapter: (verses: Verse[]) => void
  setCrossReferences: (refs: CrossReference[]) => void
  setPendingNavigation: (nav: PendingNavigation | null) => void
  requestVerseReveal: (block: ScrollLogicalPosition) => void
}

export const useBibleStore = create<BibleState>((set, get) => ({
  followDetections: false,
  followRevision: 0,
  setFollowDetections: (followDetections) => set(state => state.followDetections === followDetections ? state : ({ followDetections, followRevision: state.followRevision + 1, ...(!followDetections && state.pendingNavigation?.follow ? { pendingNavigation: null } : {}) })),
  translations: [],
  activeTranslationId: 1, // Resolved against installed metadata during hydration.
  activeTranslationCode: "KJV",
  translationSelectionStatus: "ready",
  books: [],
  searchResults: [],
  semanticResults: [],
  selectedVerse: null,
  currentChapter: [],
  crossReferences: [],
  pendingNavigation: null,
  revealRequest: 0,
  revealBlock: "nearest",

  setTranslations: (translations) => {
    const state = get()
    if (!translations.some((item) => item.is_downloaded)) {
      set({ translations, translationSelectionStatus: "unavailable" })
      return
    }
    const selected = translations.find((item) => item.is_downloaded && translationCode(item) === state.activeTranslationCode)
    if (state.translationSelectionStatus === "ready") {
      set({ translations, ...(selected ? { activeTranslationId: selected.id } : { translationSelectionStatus: "needs_confirmation" }) })
    } else set({ translations })
  },
  setActiveTranslation: (activeTranslationId) => {
    const selected = get().translations.find((item) => item.id === activeTranslationId && item.is_downloaded)
    if (!selected) return
    set({ activeTranslationId, activeTranslationCode: translationCode(selected), translationSelectionStatus: "ready" })
  },
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

/** Resolve a saved stable code against the current database, never an unverified old ID. */
export async function hydrateBibleStore(): Promise<void> {
  useBibleStore.setState({ translationSelectionStatus: "loading" })
  let translations: Translation[]
  try {
    translations = await invoke<Translation[]>("list_translations")
    useBibleStore.setState({ translations })
  } catch (error) {
    useBibleStore.setState({ translationSelectionStatus: "unavailable" })
    console.warn("[bible] Failed to load translation metadata:", error)
    return
  }
  let saved: unknown = null
  let legacyId: unknown = null
  try {
    // plugin-store suppresses initial disk/JSON errors, so hydration uses a
    // checked native read. Its absent-file result is distinct from failure.
    const preferences = await invoke<{ translationSelection?: unknown; activeTranslationId?: unknown } | null>("read_bible_preferences")
    saved = preferences?.translationSelection
    legacyId = preferences?.activeTranslationId
  } catch (error) {
    // Missing provenance is not a fresh installation. Ask the operator.
    legacyId = "unreadable"
    console.warn("[bible] Failed to read translation preference:", error)
  }
  const selection = resolveTranslationSelection(translations, saved, legacyId)
  useBibleStore.setState({
    ...(selection.translation ? { activeTranslationId: selection.translation.id } : {}),
    activeTranslationCode: selection.status === "ready" && selection.translation ? translationCode(selection.translation) : null,
    translationSelectionStatus: selection.status === "ready" ? "loading" : selection.status,
  })
  if (selection.status !== "ready" || !selection.translation) return
  try {
    await invoke("set_active_translation", { translationId: selection.translation.id })
    useBibleStore.setState({ translationSelectionStatus: "ready" })
  } catch (error) {
    useBibleStore.setState({ translationSelectionStatus: "needs_confirmation" })
    console.warn("[bible] Failed to activate saved translation:", error)
  }
}

/** Activate an explicitly chosen installed translation before confirming it. */
export async function activateTranslation(id: number): Promise<void> {
  const selected = useBibleStore.getState().translations.find((item) => item.id === id && item.is_downloaded)
  if (!selected) throw new Error("Choose an installed Bible translation.")
  const code = translationCode(selected)
  await invoke("set_active_translation", { translationId: id })
  const current = useBibleStore.getState().translations.find((item) => item.id === id && item.is_downloaded)
  if (!current || translationCode(current) !== code) throw new Error("Bible data changed. Choose the translation again.")
  useBibleStore.getState().setActiveTranslation(id)
}

/** Persist stable identity and its current catalog, with ordered disk writes. */
export async function initBiblePersistence(): Promise<() => void> {
  try {
    const store = await load("bible.json", { autoSave: false, defaults: {} })
    let timer: ReturnType<typeof setTimeout> | null = null
    let writes = Promise.resolve()
    let previousCode: string | null = null
    let stopped = false
    const schedule = () => {
      const state = useBibleStore.getState()
      if (state.translationSelectionStatus !== "ready" || !state.activeTranslationCode) {
        if (timer) clearTimeout(timer)
        timer = null
        previousCode = null
        return
      }
      if (state.activeTranslationCode === previousCode) return
      previousCode = state.activeTranslationCode
      if (timer) clearTimeout(timer)
      const selection = saveTranslationSelection(state.activeTranslationCode, state.translations)
      timer = setTimeout(() => {
        timer = null
        writes = writes.then(async () => {
          if (stopped) return
          await store.set("translationSelection", selection)
          await store.delete("activeTranslationId")
          await store.save()
        }).catch((error: unknown) => console.warn("[bible] Failed to save translation preference:", error))
      }, 500)
    }
    const unsubscribe = useBibleStore.subscribe(schedule)
    schedule()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  } catch (error) {
    console.warn("[bible] Failed to init persistence subscription:", error)
    return () => {}
  }
}
