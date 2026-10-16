import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useBibleStore } from "@/stores/bible-store"
import type { Book } from "@/types"
import { connectOutsideMaintenance } from "./operator-maintenance"

/** Catalog/bootstrap ownership belongs to the app, including when Search is hidden. */
export function connectBibleCatalog(): () => void {
  return connectOutsideMaintenance(connectActiveBibleCatalog)
}
function connectActiveBibleCatalog(): () => void {
  let stopped = false
  let revision = 0
  let key = ""
  const handle = () => {
    const state = useBibleStore.getState()
    const next = `${state.activeTranslationId}|${state.activeTranslationCode}|${state.translationSelectionStatus}`
    if (next === key) return
    key = next
    const ticket = ++revision
    if (state.translationSelectionStatus !== "ready") return
    const id = state.activeTranslationId
    const current = () =>
      !stopped &&
      ticket === revision &&
      useBibleStore.getState().translationSelectionStatus === "ready" &&
      useBibleStore.getState().activeTranslationId === id
    const apply = (books: Book[]) => {
      if (
        !current() ||
        !Array.isArray(books) ||
        books.some((book) => book.translation_id !== id)
      )
        return
      useBibleStore.getState().setBooks(books)
      const now = useBibleStore.getState()
      if (now.pendingNavigation || !books.length) return
      const source = now.selectedVerse
      if (!source && !now.allowAutomaticPreview) return
      if (source && now.currentChapter[0]?.translation_id === id) return
      const target = source
        ? {
            bookNumber: source.book_number,
            chapter: source.chapter,
            verse: source.verse,
          }
        : {
            bookNumber: (
              books.find((book) => book.book_number === 1) ?? books[0]
            ).book_number,
            chapter: 1,
            verse: 1,
          }
      now.setPendingNavigation(target)
    }
    if (
      state.books.length &&
      state.books.every((book) => book.translation_id === id)
    )
      apply(state.books)
    else
      void invoke<Book[]>("list_books", { translationId: id })
        .then(apply)
        .catch((error: unknown) => {
          if (current())
            toast.error("Could not load Bible books", {
              description: String(error),
            })
        })
  }
  const unsubscribe = useBibleStore.subscribe(handle)
  handle()
  return () => {
    stopped = true
    revision++
    unsubscribe()
  }
}
