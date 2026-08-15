import { presentVerse } from "@/hooks/use-broadcast"
import { stepVerse } from "@/hooks/use-bible"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

/**
 * Find the queue index of the verse currently on the live output.
 * Returns null when the live verse came from somewhere other than the queue.
 */
function findLiveQueueIndex(): number | null {
  const { liveVerse } = useBroadcastStore.getState()
  if (!liveVerse) return null

  const index = useQueueStore
    .getState()
    .items.findIndex((item) => item.reference === liveVerse.reference)
  return index >= 0 ? index : null
}

async function presentQueueItem(index: number): Promise<void> {
  const item = useQueueStore.getState().items[index]
  if (!item) return
  await presentVerse(item.verse).catch((e) =>
    console.warn("[remote-actions] presentQueueItem failed:", e),
  )
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
export const remoteActions = {
  /** Present the verse showing in Program preview on the live output. */
  sendToLive: () => {
    const { selectedVerse } = useBibleStore.getState()
    if (!selectedVerse) return
    void presentVerse(selectedVerse).catch((e) =>
      console.warn("[remote-actions] sendToLive failed:", e),
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

  /** Step the Bible Text panel one verse. Leaves the queue alone. */
  bibleNext: () => stepVerse("next"),
  biblePrev: () => stepVerse("prev"),

  toggleOnAir: (active: boolean) => useBroadcastStore.getState().setLive(active),
}
