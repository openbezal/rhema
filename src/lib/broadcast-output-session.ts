import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  inspectOutput,
  outputRuntimeVersion,
  syncNdiConfigToOutput,
} from "./broadcast-output-control"
import { MISSING_OUTPUT_RENDERER_ERROR, type BroadcastOutput } from "@/types"
import { useBroadcastStore } from "@/stores/broadcast-store"
interface OutputReadyPayload {
  outputId?: string
}
/** Ready/reload synchronization stays active independently of output settings panels. */
export function connectBroadcastOutputs(): () => void {
  let cancelled = false
  const unlisteners: UnlistenFn[] = []
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  const refreshTickets = new Map<string, number>()
  async function refresh(output: BroadcastOutput) {
    const ticket = (refreshTickets.get(output.id) ?? 0) + 1
    refreshTickets.set(output.id, ticket)
    const version = outputRuntimeVersion(output.id)
    const result = await inspectOutput(output)
    const store = useBroadcastStore.getState()
    if (
      cancelled ||
      refreshTickets.get(output.id) !== ticket ||
      result.uncertain ||
      outputRuntimeVersion(output.id) !== version ||
      store.outputs.find((item) => item.id === output.id) !== output
    )
      return
    const missingRenderer = result.status.ndiActive && !result.hasWindow
    const previousError = store.outputStatus[output.id]?.error
    store.setOutputStatus(output.id, {
      ...result.status,
      error: missingRenderer
        ? MISSING_OUTPUT_RENDERER_ERROR
        : previousError === MISSING_OUTPUT_RENDERER_ERROR
          ? undefined
          : previousError,
    })
    if (missingRenderer)
      useBroadcastStore.setState({ presentationRecovery: "unknown" })
    if (result.hasWindow || result.status.ndiActive) {
      store.syncBroadcastOutputFor(output.id)
      syncNdiConfigToOutput(output, result.status.ndiActive)
    }
  }
  const subscriptions = [
    listen<OutputReadyPayload>("broadcast:output-ready", (event) => {
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
    }),
    listen<OutputReadyPayload>("broadcast:native-output-status", (event) => {
      if (cancelled) return
      for (const output of useBroadcastStore.getState().outputs) {
        if (!event.payload?.outputId || output.id === event.payload.outputId)
          void refresh(output)
      }
    }),
  ]
  subscriptions.forEach((subscription) => {
    void subscription
      .then((stop) => {
        if (cancelled) stop()
        else unlisteners.push(stop)
      })
      .catch((error: unknown) => {
        if (!cancelled)
          console.warn(
            "[broadcast] Could not listen for output readiness:",
            error
          )
      })
  })
  // Closes the gap between boot inspection and listener registration, including
  // native work that outlives the old main webview's invoke Promise.
  void Promise.all(subscriptions)
    .then(() => {
      if (!cancelled)
        for (const output of useBroadcastStore.getState().outputs)
          void refresh(output)
    })
    .catch(() => {})
  return () => {
    if (cancelled) return
    cancelled = true
    unlisteners.splice(0).forEach((stop) => stop())
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}
