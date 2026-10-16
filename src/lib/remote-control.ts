import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { REMOTE_EVENTS, type RemoteEventName } from "@/lib/remote-events"
import { operatorActions } from "@/lib/operator-actions"
import { connectOutsideMaintenance } from "./operator-maintenance"

/** App-owned event subscriptions, independent of panel visibility. */
export function connectRemoteControl(): () => void {
  return connectOutsideMaintenance(connectActiveRemoteControl)
}
function connectActiveRemoteControl(): () => void {
  let cancelled = false
  const unlisteners: UnlistenFn[] = []
  // A controller sends discrete steps. Finish boundary discovery before the
  // next step reads its cursor, otherwise overlapping probes collapse inputs.
  let navigation = Promise.resolve()
  const step = (action: () => Promise<void>) => {
    navigation = navigation.then(async () => {
      if (!cancelled) await action()
    }).catch((error: unknown) => {
      if (!cancelled) console.warn("[remote-control] navigation failed:", error)
    })
  }
  const register = (event: RemoteEventName, handler: (payload: unknown) => void) => {
    void listen<unknown>(event, ({ payload }) => {
      if (!cancelled) handler(payload)
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlisteners.push(unlisten)
    }).catch((error: unknown) => {
      if (!cancelled) console.warn(`[remote-control] failed to listen for ${event}:`, error)
    })
  }

  register(REMOTE_EVENTS.next, operatorActions.queueNext)
  register(REMOTE_EVENTS.prev, operatorActions.queuePrev)
  register(REMOTE_EVENTS.send_to_live, operatorActions.sendToLive)
  register(REMOTE_EVENTS.add_to_queue, operatorActions.addToQueue)
  register(REMOTE_EVENTS.bible_next, () => step(operatorActions.bibleNext))
  register(REMOTE_EVENTS.bible_prev, () => step(operatorActions.biblePrev))
  register(REMOTE_EVENTS.show, () => operatorActions.toggleOnAir(true))
  register(REMOTE_EVENTS.hide, () => operatorActions.toggleOnAir(false))
  register(REMOTE_EVENTS.auto_broadcast, operatorActions.toggleAutoLive)
  register(REMOTE_EVENTS.set_auto_broadcast, (raw) => {
    const active = parsePayload(raw)?.active
    if (typeof active === "boolean") operatorActions.setAutoLive(active)
  })
  register(REMOTE_EVENTS.theme, (raw) => {
    const name = parsePayload(raw)?.name
    if (typeof name !== "string" || !name) return
    const state = useBroadcastStore.getState()
    const theme = state.themes.find((theme) => theme.name.toLowerCase() === name.toLowerCase())
    if (theme) state.setActiveTheme(theme.id)
  })
  register(REMOTE_EVENTS.opacity, () => {
    // The broadcast store has no opacity field; retain the existing no-op.
  })
  register(REMOTE_EVENTS.on_air, (raw) => {
    const active = parsePayload(raw)?.active
    if (typeof active === "boolean") operatorActions.toggleOnAir(active)
  })
  register(REMOTE_EVENTS.confidence, (raw) => {
    const value = parsePayload(raw)?.value
    if (typeof value === "number" && Number.isFinite(value)) {
      useSettingsStore.getState().setConfidenceThreshold(value)
    }
  })

  return () => {
    if (cancelled) return
    cancelled = true
    unlisteners.forEach((unlisten) => unlisten())
  }
}

function parsePayload(raw: unknown): Record<string, unknown> | null {
  let value = raw
  if (typeof raw === "string") {
    try { value = JSON.parse(raw) } catch { return null }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}
