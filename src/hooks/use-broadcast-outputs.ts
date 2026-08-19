import { useEffect } from "react"
import { listen } from "@tauri-apps/api/event"
import { useBroadcastStore } from "@/stores"
import { syncNdiConfigToOutput } from "@/lib/broadcast-output-control"

interface OutputReadyPayload {
  outputId?: string
}

/**
 * Re-sync an output window whenever it reports ready — on first load and after
 * any reload. Mounted app-wide rather than in the broadcast dialog, so a
 * projector that reloads while the dialog is closed still gets its content.
 */
export function useBroadcastOutputs(): void {
  useEffect(() => {
    const timeouts: Array<ReturnType<typeof setTimeout>> = []

    const unlistenPromise = listen<OutputReadyPayload>("broadcast:output-ready", (event) => {
      const store = useBroadcastStore.getState()
      const outputId = event.payload?.outputId
      const outputs = outputId
        ? store.outputs.filter((o) => o.id === outputId)
        : store.outputs

      for (const output of outputs) {
        store.syncBroadcastOutputFor(output.id)
        syncNdiConfigToOutput(output, store.outputStatus[output.id]?.ndiActive ?? false)
        // The window reports ready before its first paint settles.
        timeouts.push(
          setTimeout(() => {
            useBroadcastStore.getState().syncBroadcastOutputFor(output.id)
          }, 150)
        )
      }
    })

    return () => {
      for (const id of timeouts) clearTimeout(id)
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])
}
