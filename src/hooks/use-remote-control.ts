import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { toVerseRenderData } from "@/hooks/use-broadcast"

/**
 * Listens for remote control events from the Rust backend (OSC / HTTP API)
 * and dispatches them to the appropriate Zustand stores.
 *
 * Mount this hook once at the app root level.
 */
export function useRemoteControl() {
  useEffect(() => {
    let cancelled = false
    const unlisteners: UnlistenFn[] = []

    async function setup() {
      // remote:next — advance queue to next verse and present it
      const u1 = await listen("remote:next", () => {
        if (cancelled) return
        const { items, activeIndex } = useQueueStore.getState()
        if (items.length === 0) return
        const nextIndex =
          activeIndex === null ? 0 : Math.min(activeIndex + 1, items.length - 1)
        useQueueStore.getState().setActive(nextIndex)
        presentQueueItem(nextIndex)
      })
      unlisteners.push(u1)

      // remote:prev — go to previous verse in queue and present it
      const u2 = await listen("remote:prev", () => {
        if (cancelled) return
        const { items, activeIndex } = useQueueStore.getState()
        if (items.length === 0) return
        const prevIndex =
          activeIndex === null ? 0 : Math.max(activeIndex - 1, 0)
        useQueueStore.getState().setActive(prevIndex)
        presentQueueItem(prevIndex)
      })
      unlisteners.push(u2)

      // remote:theme — switch active theme by name
      const u3 = await listen<string>("remote:theme", (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const name = payload?.name as string | undefined
        if (!name) return

        const { themes } = useBroadcastStore.getState()
        const theme = themes.find(
          (t) => t.name.toLowerCase() === name.toLowerCase()
        )
        if (theme) {
          useBroadcastStore.getState().setActiveTheme(theme.id)
        }
      })
      unlisteners.push(u3)

      // remote:opacity — set broadcast output opacity
      const u4 = await listen<string>("remote:opacity", (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const value = payload?.value as number | undefined
        if (value === undefined) return
        // Opacity is stored on the live verse rendering; for now broadcast
        // store doesn't have a dedicated opacity field — this is a placeholder
        // that can be wired when the broadcast store adds opacity support.
        void value
      })
      unlisteners.push(u4)

      // remote:on_air — toggle live broadcast state
      const u5 = await listen<string>("remote:on_air", (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const active = payload?.active as boolean | undefined
        if (active === undefined) return
        useBroadcastStore.getState().setLive(active)
      })
      unlisteners.push(u5)

      // remote:show — show broadcast output
      const u6 = await listen("remote:show", () => {
        if (cancelled) return
        useBroadcastStore.getState().setLive(true)
      })
      unlisteners.push(u6)

      // remote:hide — hide broadcast output
      const u7 = await listen("remote:hide", () => {
        if (cancelled) return
        useBroadcastStore.getState().setLive(false)
      })
      unlisteners.push(u7)

      // remote:confidence — set detection confidence threshold
      const u8 = await listen<string>("remote:confidence", (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const value = payload?.value as number | undefined
        if (value === undefined) return
        useSettingsStore.getState().setConfidenceThreshold(value)
      })
      unlisteners.push(u8)
    }

    setup()

    // Sync status snapshot to Rust backend periodically for HTTP GET /api/v1/status
    const statusInterval = setInterval(() => {
      syncStatusSnapshot()
    }, 1000)

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
      clearInterval(statusInterval)
    }
  }, [])
}

/**
 * Present a queue item at the given index to the live display.
 * Mirrors the logic from QueueItemRow's handlePresent.
 */
function presentQueueItem(index: number) {
  const { items } = useQueueStore.getState()
  const item = items[index]
  if (!item) return

  const translation =
    useBibleStore
      .getState()
      .translations.find(
        (t) => t.id === useBibleStore.getState().activeTranslationId
      )?.abbreviation ?? "KJV"

  useBroadcastStore
    .getState()
    .setLiveVerse(toVerseRenderData(item.verse, translation))
}

/**
 * Push current frontend state to the Rust-managed StatusSnapshot.
 */
function syncStatusSnapshot() {
  const broadcast = useBroadcastStore.getState()
  const queue = useQueueStore.getState()
  const settings = useSettingsStore.getState()

  const activeTheme = broadcast.themes.find(
    (t) => t.id === broadcast.activeThemeId
  )

  invoke("update_remote_status", {
    onAir: broadcast.isLive,
    activeTheme: activeTheme?.name ?? null,
    liveVerse: broadcast.liveVerse?.reference ?? null,
    queueLength: queue.items.length,
    confidenceThreshold: settings.confidenceThreshold,
  }).catch(() => {
    // Silently ignore — HTTP server may not be running
  })
}

/**
 * Safely parse a JSON string payload from a Tauri event.
 */
function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw as Record<string, unknown>
  }
  return null
}
