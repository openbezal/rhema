import { invoke } from "@tauri-apps/api/core"
import { useDetectionStore } from "@/stores"
import type { DetectionResult } from "@/types"

// Stable action functions (same pattern as use-bible.ts)
async function detectVerses(text: string) {
  const results = await invoke<DetectionResult[]>("detect_verses", { text })
  if (results.length > 0) {
    useDetectionStore.getState().addDetections(results)
  }
  return results
}

async function getDetectionStatus() {
  return invoke<{ has_direct: boolean; has_semantic: boolean }>(
    "detection_status"
  )
}

export const detectionActions = {
  detectVerses,
  getDetectionStatus,
  clearDetections: () => useDetectionStore.getState().clearDetections(),
  removeDetection: (verseRef: string) =>
    useDetectionStore.getState().removeDetection(verseRef),
}

export function useDetection() {
  const detections = useDetectionStore((s) => s.detections)
  const autoMode = useDetectionStore((s) => s.autoMode)
  const confidenceThreshold = useDetectionStore((s) => s.confidenceThreshold)

  return {
    detections,
    autoMode,
    confidenceThreshold,
    ...detectionActions,
  }
}
