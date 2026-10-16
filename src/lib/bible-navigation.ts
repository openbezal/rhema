import { fetchChapter, findLoadedVerse } from "@/hooks/use-bible"
import { presentVerse } from "@/hooks/use-broadcast"
import {
  reservePresentationIntent,
  isPresentationIntentCurrent,
} from "./presentation-controller"
import { useBibleStore } from "@/stores/bible-store"
import { mark } from "@/lib/latency-marks"
import {
  connectOutsideMaintenance,
  isOperatorMaintenanceActive,
} from "./operator-maintenance"

/** Complete pending navigation even when the Bible panel is hidden. */
export function connectBibleNavigation(): () => void {
  return connectOutsideMaintenance(() => {
    const stop = connectActiveBibleNavigation()
    return () => {
      stop()
      if (isOperatorMaintenanceActive())
        useBibleStore.getState().setPendingNavigation(null)
    }
  })
}
function connectActiveBibleNavigation(): () => void {
  let stopped = false
  let revision = 0
  let lastPending: ReturnType<
    typeof useBibleStore.getState
  >["pendingNavigation"] = null
  let lastTranslation = 0
  const handle = () => {
    const state = useBibleStore.getState()
    const pending = state.pendingNavigation
    if (
      pending?.typedIntent &&
      (pending.typedIntent.translationId !== state.activeTranslationId ||
        pending.typedIntent.initialSelection !== state.selectedVerse)
    ) {
      state.setPendingNavigation(null)
      return
    }
    if (
      pending === lastPending &&
      state.activeTranslationId === lastTranslation
    )
      return
    lastPending = pending
    lastTranslation = state.activeTranslationId
    const ticket = ++revision
    if (!pending) return
    const { bookNumber, chapter, verse, present } = pending
    if (!state.books.some((book) => book.book_number === bookNumber)) {
      state.setPendingNavigation(null)
      return
    }
    const translationId = state.activeTranslationId
    const presentationRevision =
      pending.presentationRevision ??
      (present ? reservePresentationIntent() : undefined)
    const ownsRequest = () =>
      !stopped &&
      ticket === revision &&
      useBibleStore.getState().pendingNavigation === pending &&
      useBibleStore.getState().activeTranslationId === translationId
    const isCurrent = () =>
      ownsRequest() &&
      (presentationRevision === undefined ||
        isPresentationIntentCurrent(presentationRevision))
    if (!isCurrent()) {
      if (ownsRequest()) useBibleStore.getState().setPendingNavigation(null)
      return
    }

    mark(`nav loadChapter start ${bookNumber} ${chapter}:${verse}`)
    void fetchChapter(bookNumber, chapter, translationId)
      .then((verses) => {
        if (!isCurrent()) return
        const target = findLoadedVerse(verses, pending)
        if (!target) return
        // A stale request must never write even the chapter rows.
        useBibleStore.getState().setCurrentChapter(verses)
        useBibleStore.getState().selectVerse(target)
        if (present)
          void presentVerse(target, { intentRevision: presentationRevision })
        useBibleStore.getState().requestVerseReveal("center")
        mark(`nav loadChapter done ${bookNumber} ${chapter}:${verse}`)
      })
      .catch((error: unknown) => {
        if (isCurrent()) console.error("[bible] navigation failed:", error)
      })
      .finally(() => {
        if (ownsRequest()) useBibleStore.getState().setPendingNavigation(null)
      })
  }
  const unsubscribe = useBibleStore.subscribe(handle)
  handle()
  return () => {
    stopped = true
    revision += 1
    unsubscribe()
  }
}
