import { create } from "zustand"
import type { DetectionResult } from "@/types"

interface DetectionState {
  detections: DetectionResult[]
  autoMode: boolean
  confidenceThreshold: number

  addDetection: (detection: DetectionResult) => void
  addDetections: (detections: DetectionResult[]) => void
  setDetections: (detections: DetectionResult[]) => void
  removeDetection: (verseRef: string) => void
  clearDetections: () => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
}

export const useDetectionStore = create<DetectionState>((set) => ({
  detections: [],
  autoMode: false,
  confidenceThreshold: 0.8,

  addDetection: (detection) =>
    set((state) => {
      // Deduplicate: if same verse_ref exists, keep higher confidence at top
      const filtered = state.detections.filter(
        (d) => d.verse_ref !== detection.verse_ref || d.confidence > detection.confidence,
      )
      // If we filtered one out, the new one has higher (or equal) confidence
      if (filtered.length < state.detections.length) {
        return { detections: [detection, ...filtered].slice(0, 50) }
      }
      // Check if it was already there with higher confidence
      if (state.detections.some((d) => d.verse_ref === detection.verse_ref)) {
        return state // existing has higher confidence, keep it
      }
      return { detections: [detection, ...state.detections].slice(0, 50) }
    }),
  addDetections: (incoming) =>
    set((state) => {
      const incomingSemantic = incoming.filter((d) => d.source === "semantic")
      const incomingDirect = incoming.filter((d) => d.source !== "semantic")

      // Semantic detections are a fresh ranking for the LATEST utterance —
      // a new batch replaces the previous one outright, in backend rank
      // order. Accumulating batches let a stale hit sit above the newest
      // ranking forever (same synthetic confidences, older entry wins).
      const semantic =
        incomingSemantic.length > 0
          ? incomingSemantic.slice(0, 25)
          : state.detections.filter((d) => d.source === "semantic")

      // Direct detections are explicit spoken references — keep a recent
      // history, deduped by reference, newest first.
      const seen = new Set<string>()
      const direct: DetectionResult[] = []
      for (const d of [
        ...incomingDirect,
        ...state.detections.filter((x) => x.source !== "semantic"),
      ]) {
        if (!seen.has(d.verse_ref)) {
          seen.add(d.verse_ref)
          direct.push(d)
        }
      }

      return { detections: [...direct.slice(0, 25), ...semantic] }
    }),
  setDetections: (detections) => set({ detections }),
  removeDetection: (verseRef) =>
    set((state) => ({
      detections: state.detections.filter((d) => d.verse_ref !== verseRef),
    })),
  clearDetections: () => set({ detections: [] }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) =>
    set({ confidenceThreshold }),
}))
