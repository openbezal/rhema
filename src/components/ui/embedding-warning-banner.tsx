import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { AlertTriangleIcon, XIcon } from "lucide-react"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import type { DetectionStatus } from "@/types"

/**
 * Amber warning strip shown when the backend reports that the semantic
 * embedding index was built with a different ONNX model than the one the
 * app loaded (semantic results would be unreliable). Renders nothing in the
 * healthy cases: no embeddings installed, or index and model match.
 *
 * Two sources: the initial detection_status fetch (sidecar check at
 * startup) and the "embedding_warning" event pushed when the background
 * self-check — which needs no sidecar — finishes a few seconds later.
 */
export function EmbeddingWarningBanner() {
  const [warning, setWarning] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    invoke<DetectionStatus>("detection_status")
      .then((status) => {
        if (status.embedding_warning) setWarning(status.embedding_warning)
      })
      .catch(() => {})
  }, [])

  useTauriEvent<string>("embedding_warning", (message) => {
    setWarning(message)
  })

  // Always occupy the grid row — the parent grid's `auto` row collapses to
  // zero height when this is empty, and other rows keep their slots.
  if (!warning || dismissed) return <div className="col-span-4" />

  return (
    <div
      role="alert"
      className="col-span-4 flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-500"
    >
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{warning}</span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss warning"
        className="shrink-0 rounded p-1 transition-colors hover:bg-amber-500/20"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
