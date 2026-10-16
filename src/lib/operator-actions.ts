import { requestOnAir } from "./output-safety"
import {
  presentVerse,
  presentPrimaryVerse,
  clearLive,
} from "./presentation-controller"
import { stepVerse } from "@/hooks/use-bible"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * Find the queue index of the verse currently on the live output.
 * Returns null when the live verse came from somewhere other than the queue.
 */
function findLiveQueueIndex(): number | null {
  const { liveSourceVerse } = useBroadcastStore.getState()
  if (!liveSourceVerse) return null
  const index = useQueueStore
    .getState()
    .items.findIndex(
      (item) =>
        item.verse.book_number === liveSourceVerse.book_number &&
        item.verse.chapter === liveSourceVerse.chapter &&
        item.verse.verse === liveSourceVerse.verse
    )
  return index >= 0 ? index : null
}

async function presentQueueItem(index: number): Promise<boolean> {
  const item = useQueueStore.getState().items[index]
  if (!item) return false
  useQueueStore.getState().setActive(index)
  // Navigate the Bible panel to the presented verse, as detections do
  useBibleStore.getState().setPendingNavigation({
    bookNumber: item.verse.book_number,
    chapter: item.verse.chapter,
    verse: item.verse.verse,
  })
  // The primary commit completes this operator action. Optional language text
  // can arrive later without holding Queue selection or other keyboard work.
  return presentPrimaryVerse(item.verse).catch((error: unknown) => {
    console.warn("[remote-actions] presentQueueItem failed:", error)
    return false
  })
}

function stepQueue(offset: number): void {
  const { items, activeIndex } = useQueueStore.getState()
  if (items.length === 0) return

  const current = activeIndex ?? findLiveQueueIndex()
  const target =
    current === null
      ? 0
      : Math.min(Math.max(current + offset, 0), items.length - 1)

  useQueueStore.getState().setActive(target)
  void presentQueueItem(target)
}

/**
 * Operator actions reachable from every control surface — OSC, the HTTP API,
 * and (from Phase 2) the keyboard. Each surface dispatches into this registry
 * rather than carrying its own copy of the behaviour, so the surfaces cannot
 * drift apart.
 *
 * Plain functions over `getState()`, never hooks: these run from Tauri event
 * callbacks, outside React's render cycle.
 */
export const operatorActions = {
  presentQueueItem,
  /** Present the verse showing in Program preview on the live output. */
  sendToLive: () => {
    const { selectedVerse } = useBibleStore.getState()
    if (!selectedVerse) return
    void presentVerse(selectedVerse).catch((e) =>
      console.warn("[remote-actions] sendToLive failed:", e)
    )
  },

  /** Queue the verse showing in Program preview. Duplicates are dropped by the store. */
  addToQueue: () => {
    const { selectedVerse } = useBibleStore.getState()
    if (!selectedVerse) return
    useQueueStore.getState().addItem({
      id: crypto.randomUUID(),
      verse: selectedVerse,
      reference: `${selectedVerse.book_name} ${selectedVerse.chapter}:${selectedVerse.verse}`,
      confidence: 1,
      source: "manual",
      added_at: Date.now(),
    })
  },

  queueNext: () => stepQueue(1),
  queuePrev: () => stepQueue(-1),

  /** Present the next/previous Bible verse without moving the queue or going on air. */
  bibleNext: (intentOwner?: object) =>
    stepVerse("next", { present: true, intentOwner }),
  biblePrev: (intentOwner?: object) =>
    stepVerse("prev", { present: true, intentOwner }),

  clearLive,
  setFollowDetections: (enabled: boolean) =>
    useBibleStore.getState().setFollowDetections(enabled),

  setAutoLive: (enabled: boolean) =>
    useBroadcastStore.getState().setAutoLive(enabled),
  toggleAutoLive: () => {
    const state = useBroadcastStore.getState()
    state.setAutoLive(!state.autoLive)
  },

  toggleOnAir: async (active: boolean) => {
    if (
      !(await requestOnAir(active)) ||
      !active ||
      !useBroadcastStore.getState().isLive
    )
      return
    if (
      !useBroadcastStore.getState().liveVerse &&
      !useBroadcastStore.getState().hasExplicitClear
    ) {
      const selected = useBibleStore.getState().selectedVerse
      if (selected)
        await presentPrimaryVerse(selected).catch((error) =>
          console.warn("[remote-actions] on-air preview failed:", error)
        )
    }
  },
}
