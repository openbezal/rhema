import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useBroadcastStore } from "@/stores/broadcast-store"
interface OutputReadyPayload {
  outputId?: string
}
/** Ready/reload synchronization stays active independently of output settings panels. */
export function connectBroadcastOutputs(): () => void {
  let cancelled = false
  let unlisten: UnlistenFn | undefined
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  void listen<OutputReadyPayload>("broadcast:output-ready", (event) => {
    if (cancelled) return
    const store = useBroadcastStore.getState()
    const outputs = event.payload?.outputId
      ? store.outputs.filter((output) => output.id === event.payload.outputId)
      : store.outputs
    for (const output of outputs) {
      store.syncBroadcastOutputFor(output.id)
      const old = pending.get(output.id)
      if (old) clearTimeout(old)
      pending.set(
        output.id,
        setTimeout(() => {
          pending.delete(output.id)
          if (!cancelled)
            useBroadcastStore.getState().syncBroadcastOutputFor(output.id)
        }, 150)
      )
    }
  })
    .then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    })
    .catch((error: unknown) => {
      if (!cancelled)
        console.warn(
          "[broadcast] Could not listen for output readiness:",
          error
        )
    })
  return () => {
    if (cancelled) return
    cancelled = true
    unlisten?.()
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}
