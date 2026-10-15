import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useBibleStore } from "@/stores/bible-store"
import type { Verse } from "@/types"

/** Refresh the browsed reference without coupling it to panel visibility or live content. */
export function connectPreviewSelection(): () => void {
  let stopped = false
  let revision = 0
  let previousVerse: Verse | null | undefined
  let previousSelection = ""
  const handle = () => {
    const state = useBibleStore.getState()
    const source = state.selectedVerse
    const selection = `${state.activeTranslationId}|${state.activeTranslationCode}|${state.translationSelectionStatus}`
    if (source === previousVerse && selection === previousSelection) return
    previousVerse = source
    previousSelection = selection
    const ticket = ++revision
    if (
      !source ||
      state.translationSelectionStatus !== "ready" ||
      source.translation_id === state.activeTranslationId
    )
      return
    const id = state.activeTranslationId
    const current = () =>
      !stopped &&
      ticket === revision &&
      useBibleStore.getState().selectedVerse === source &&
      useBibleStore.getState().activeTranslationId === id &&
      useBibleStore.getState().translationSelectionStatus === "ready"
    void invoke<Verse | null>("get_verse", {
      translationId: id,
      bookNumber: source.book_number,
      chapter: source.chapter,
      verse: source.verse,
    })
      .then((row) => {
        if (!current()) return
        if (
          !row ||
          row.translation_id !== id ||
          row.book_number !== source.book_number ||
          row.chapter !== source.chapter ||
          row.verse !== source.verse ||
          !row.text?.trim()
        ) {
          toast.error("Preview verse unavailable in the selected translation", {
            id: "preview-lookup",
            description:
              "The previous preview is retained with its original translation label.",
          })
          return
        }
        useBibleStore.getState().selectVerse(row)
      })
      .catch((error: unknown) => {
        if (current())
          toast.error("Could not refresh the preview", {
            id: "preview-lookup",
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
