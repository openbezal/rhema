import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { connectRemoteControl } from "@/lib/remote-control"

/**
 * Listens for remote control events from the Rust backend (OSC / HTTP API)
 * and dispatches them to the appropriate Zustand stores.
 *
 * Mount this hook once at the app root level.
 */
export function useRemoteControl() {
  useEffect(() => {
    const disconnect = connectRemoteControl()

    // Sync status snapshot to Rust backend periodically for HTTP GET /api/v1/status
    const statusInterval = setInterval(() => {
      syncStatusSnapshot()
    }, 1000)

    return () => {
      disconnect()
      clearInterval(statusInterval)
    }
  }, [])
}

/**
 * Push current frontend state to the Rust-managed StatusSnapshot.
 */
export function syncStatusSnapshot() {
  const broadcast = useBroadcastStore.getState()
  const queue = useQueueStore.getState()
  const settings = useSettingsStore.getState()

  const activeTheme = broadcast.themes.find(
    (t) => t.id === broadcast.activeThemeId
  )

  invoke("update_remote_status", {
    onAir: broadcast.isLive,
    autoBroadcast: broadcast.autoLive,
    activeTheme: activeTheme?.name ?? null,
    liveVerse: broadcast.liveVerse?.reference ?? null,
    queueLength: queue.items.length,
    confidenceThreshold: settings.confidenceThreshold,
  }).catch(() => {
    // Silently ignore — HTTP server may not be running
  })
}
