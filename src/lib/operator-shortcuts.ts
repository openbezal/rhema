import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { operatorActions } from "./operator-actions"
import { useOperatorUiStore } from "./operator-ui"
import { isEditableTarget, type ShortcutId } from "./shortcut-registry"
import { transcriptionActions } from "@/hooks/use-transcription"
import { fetchChapter } from "@/hooks/use-bible"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import {
  reservePresentationIntent,
  isPresentationIntentCurrent,
  isPresentationOwnerCurrent,
} from "./presentation-controller"

type Panel =
  "transcript" | "queue" | "search" | "detections" | "preview" | "live-output"
export function focusOperatorPanel(panel: Panel): boolean {
  const element = document.querySelector<HTMLElement>(
    `[data-slot="${panel}-panel"]`
  )
  if (!element) return false
  const target =
    panel === "search"
      ? (element.querySelector<HTMLElement>("[data-operator-list]") ?? element)
      : element
  target.focus()
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  return document.activeElement === target
}
/** Probe before moving so the last/missing chapter cannot blank the browser. */
export async function stepChapter(
  direction: "next" | "prev",
  owner?: object
): Promise<void> {
  const state = useBibleStore.getState()
  if (state.translationSelectionStatus !== "ready") return
  const cursor =
    state.pendingNavigation ??
    (state.selectedVerse
      ? {
          bookNumber: state.selectedVerse.book_number,
          chapter: state.selectedVerse.chapter,
        }
      : null)
  if (!cursor) return
  const chapter = cursor.chapter + (direction === "next" ? 1 : -1)
  if (chapter < 1) return
  const ticket = reservePresentationIntent(owner)
  try {
    const rows = await fetchChapter(
      cursor.bookNumber,
      chapter,
      state.activeTranslationId
    )
    if (
      !isPresentationIntentCurrent(ticket) ||
      useBibleStore.getState().activeTranslationId !== state.activeTranslationId
    )
      return
    const first = rows.find(
      (row) =>
        row.translation_id === state.activeTranslationId &&
        row.book_number === cursor.bookNumber &&
        row.chapter === chapter &&
        row.verse > 0 &&
        row.text.trim()
    )
    if (first)
      useBibleStore.getState().setPendingNavigation({
        bookNumber: cursor.bookNumber,
        chapter,
        verse: first.verse,
        present: true,
        presentationRevision: ticket,
      })
  } catch (error) {
    toast.error("Could not load chapter", { description: String(error) })
  }
}
let navigation: { owner: object; tail: Promise<void> } | null = null
function enqueueNavigation(action: (owner: object) => Promise<void>) {
  if (!navigation || !isPresentationOwnerCurrent(navigation.owner)) {
    const owner = {}
    reservePresentationIntent(owner)
    navigation = { owner, tail: Promise.resolve() }
  }
  const batch = navigation
  batch.tail = batch.tail
    .then(async () => {
      if (isPresentationOwnerCurrent(batch.owner)) await action(batch.owner)
    })
    .catch((error: unknown) => {
      console.warn("[keyboard] Navigation failed:", error)
    })
  return batch.tail
}
function focusedItem(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : null
  return {
    list: target?.closest<HTMLElement>("[data-operator-list]"),
    item: target?.closest<HTMLElement>("[data-operator-item]"),
  }
}
function focusItem(item: HTMLElement | undefined) {
  item?.focus()
  item?.scrollIntoView?.({ block: "nearest" })
}
export async function runShortcutCommand(
  id: ShortcutId,
  event: KeyboardEvent
): Promise<void> {
  if (id === "toggle-live")
    return operatorActions.toggleOnAir(!useBroadcastStore.getState().isLive)
  if (id === "toggle-transcription") {
    const state = useTranscriptStore.getState()
    if (state.connectionStatus === "connecting" && !state.isTranscribing) return
    return state.isTranscribing
      ? transcriptionActions.stop()
      : transcriptionActions.start()
  }
  if (id === "show-shortcuts") {
    useOperatorUiStore.setState({ shortcutsOpen: true })
    return
  }
  if (id === "show-commands") {
    useOperatorUiStore.setState({ commandsOpen: true })
    return
  }
  if (id === "focus-search") {
    useOperatorUiStore.setState((state) => ({
      searchFocusRevision: state.searchFocusRevision + 1,
    }))
    return
  }
  if (id.startsWith("focus-")) {
    const panels: Partial<Record<ShortcutId, Panel>> = {
      "focus-transcript": "transcript",
      "focus-queue": "queue",
      "focus-search-panel": "search",
      "focus-detections": "detections",
      "focus-preview": "preview",
      "focus-live": "live-output",
    }
    const panel = panels[id]
    if (panel) focusOperatorPanel(panel)
    return
  }
  if (id === "escape") {
    if (isEditableTarget(event.target)) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      return
    }
    ;(document.activeElement as HTMLElement | null)?.blur()
    await invoke("stop_reading_mode").catch((error: unknown) =>
      toast.error("Could not leave reading mode", {
        description: String(error),
      })
    )
    return
  }
  if (id === "next-verse") return enqueueNavigation(operatorActions.bibleNext)
  if (id === "previous-verse")
    return enqueueNavigation(operatorActions.biblePrev)
  if (id === "next-chapter")
    return enqueueNavigation((owner) => stepChapter("next", owner))
  if (id === "previous-chapter")
    return enqueueNavigation((owner) => stepChapter("prev", owner))
  const { list, item } = focusedItem(event)
  if (!list) return
  const items = [...list.querySelectorAll<HTMLElement>("[data-operator-item]")]
  const index = item ? items.indexOf(item) : -1
  if (id === "list-next" || id === "list-previous") {
    const next =
      index < 0
        ? id === "list-next"
          ? 0
          : items.length - 1
        : Math.max(
            0,
            Math.min(items.length - 1, index + (id === "list-next" ? 1 : -1))
          )
    focusItem(items[next])
    return
  }
  if (!item) return
  if (id === "list-remove" && list.dataset.operatorList === "queue") {
    item.querySelector<HTMLButtonElement>("[data-operator-remove]")?.click()
    await Promise.resolve()
    const remaining = [
      ...list.querySelectorAll<HTMLElement>("[data-operator-item]"),
    ]
    focusItem(remaining[Math.min(Math.max(0, index), remaining.length - 1)])
    return
  }
  if (id === "list-present-clear" && list.dataset.operatorList === "queue") {
    const itemId = item.dataset.operatorItem
    const index = useQueueStore
      .getState()
      .items.findIndex((row) => row.id === itemId)
    if (index < 0) return
    const queued = useQueueStore.getState().items[index]
    const operation = operatorActions.presentQueueItem(index)
    const selectionRevision = useQueueStore.getState().selectionRevision
    const committed = await operation
    const queue = useQueueStore.getState()
    const source = useBroadcastStore.getState().liveSourceVerse
    if (
      committed &&
      queue.selectionRevision === selectionRevision &&
      queue.activeIndex !== null &&
      queue.items[queue.activeIndex]?.id === itemId &&
      source?.book_number === queued.verse.book_number &&
      source.chapter === queued.verse.chapter &&
      source.verse === queued.verse.verse
    )
      queue.setActive(null)
    return
  }
  if (id === "list-present") {
    const button = item.matches("[data-operator-present]")
      ? item
      : item.querySelector<HTMLElement>("[data-operator-present]")
    if (button && !button.matches(':disabled,[aria-disabled="true"]'))
      button.click()
  }
}
