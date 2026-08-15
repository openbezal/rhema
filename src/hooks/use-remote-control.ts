import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { REMOTE_EVENTS } from "@/lib/remote-events"
import { remoteActions } from "@/lib/remote-actions"

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
      const register = async (event: string, handler: () => void) => {
        unlisteners.push(
          await listen(event, () => {
            if (cancelled) return
            handler()
          }),
        )
      }

      await register(REMOTE_EVENTS.next, remoteActions.queueNext)
      await register(REMOTE_EVENTS.prev, remoteActions.queuePrev)
      await register(REMOTE_EVENTS.send_to_live, remoteActions.sendToLive)
      await register(REMOTE_EVENTS.add_to_queue, remoteActions.addToQueue)
      await register(REMOTE_EVENTS.bible_next, remoteActions.bibleNext)
      await register(REMOTE_EVENTS.bible_prev, remoteActions.biblePrev)
      await register(REMOTE_EVENTS.show, () => remoteActions.toggleOnAir(true))
      await register(REMOTE_EVENTS.hide, () => remoteActions.toggleOnAir(false))

      // remote:theme — switch active theme by name
      const u3 = await listen<string>(REMOTE_EVENTS.theme, (event) => {
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
      const u4 = await listen<string>(REMOTE_EVENTS.opacity, (event) => {
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
      const u5 = await listen<string>(REMOTE_EVENTS.on_air, (event) => {
        if (cancelled) return
        const payload = parsePayload(event.payload)
        const active = payload?.active as boolean | undefined
        if (active === undefined) return
        remoteActions.toggleOnAir(active)
      })
      unlisteners.push(u5)

      // remote:confidence — set detection confidence threshold
      const u8 = await listen<string>(REMOTE_EVENTS.confidence, (event) => {
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
