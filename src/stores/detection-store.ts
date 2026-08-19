import { create } from "zustand"
import type { DetectionResult } from "@/types"

/**
 * How long a dismissed reference stays suppressed (issue #149).
 *
 * Direct detection re-runs on every changed partial and again on the final, so
 * a plain removal would be undone a second later by the same utterance. The
 * window outlives that re-emit burst but still lets the verse show up if the
 * speaker genuinely returns to it later.
 */
export const DISMISS_SUPPRESSION_MS = 10_000

type DetectionSource = DetectionResult["source"]

// Suppression key: dismissing a direct hit must not also hide the semantic
// card for the same verse.
function dismissKey(verseRef: string, source: DetectionSource): string {
  return `${source}|${verseRef}`
}

// Drop entries whose window has passed. Expiry is checked lazily on write —
// no timers to schedule or clean up.
function pruneDismissed(
  dismissed: Record<string, number>,
  now: number
): Record<string, number> {
  const live: Record<string, number> = {}
  for (const [key, expiresAt] of Object.entries(dismissed)) {
    if (expiresAt > now) live[key] = expiresAt
  }
  return live
}

interface DetectionState {
  detections: DetectionResult[]
  // Dismissed `source|verse_ref` keys → the time their suppression expires.
  dismissed: Record<string, number>
  autoMode: boolean
  confidenceThreshold: number

  addDetection: (detection: DetectionResult) => void
  addDetections: (detections: DetectionResult[]) => void
  setDetections: (detections: DetectionResult[]) => void
  removeDetection: (verseRef: string) => void
  dismissDetection: (verseRef: string, source: DetectionSource) => void
  isDismissed: (verseRef: string, source: DetectionSource) => boolean
  clearDetections: () => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
}

export const useDetectionStore = create<DetectionState>((set, get) => ({
  detections: [],
  dismissed: {},
  autoMode: false,
  confidenceThreshold: 0.8,

  addDetection: (detection) =>
    set((state) => {
      const dismissed = pruneDismissed(state.dismissed, Date.now())
      // Dismissed by the operator — stay out of the list until the window ends
      if (dismissed[dismissKey(detection.verse_ref, detection.source)]) {
        return { dismissed }
      }
      // Deduplicate: if same verse_ref exists, keep higher confidence at top
      const filtered = state.detections.filter(
        (d) => d.verse_ref !== detection.verse_ref || d.confidence > detection.confidence,
      )
      // If we filtered one out, the new one has higher (or equal) confidence
      if (filtered.length < state.detections.length) {
        return { detections: [detection, ...filtered].slice(0, 50), dismissed }
      }
      // Check if it was already there with higher confidence
      if (state.detections.some((d) => d.verse_ref === detection.verse_ref)) {
        return { dismissed } // existing has higher confidence, keep it
      }
      return { detections: [detection, ...state.detections].slice(0, 50), dismissed }
    }),
  addDetections: (incoming) =>
    set((state) => {
      const dismissed = pruneDismissed(state.dismissed, Date.now())
      const accepted = incoming.filter(
        (d) => !dismissed[dismissKey(d.verse_ref, d.source)]
      )
      const incomingSemantic = accepted.filter((d) => d.source === "semantic")
      const incomingDirect = accepted.filter((d) => d.source !== "semantic")

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

      return { detections: [...direct.slice(0, 25), ...semantic], dismissed }
    }),
  setDetections: (detections) => set({ detections }),
  removeDetection: (verseRef) =>
    set((state) => ({
      detections: state.detections.filter((d) => d.verse_ref !== verseRef),
    })),
  dismissDetection: (verseRef, source) =>
    set((state) => {
      const now = Date.now()
      return {
        detections: state.detections.filter(
          (d) => d.verse_ref !== verseRef || d.source !== source
        ),
        dismissed: {
          ...pruneDismissed(state.dismissed, now),
          [dismissKey(verseRef, source)]: now + DISMISS_SUPPRESSION_MS,
        },
      }
    }),
  isDismissed: (verseRef, source) => {
    const expiresAt = get().dismissed[dismissKey(verseRef, source)]
    return expiresAt !== undefined && expiresAt > Date.now()
  },
  clearDetections: () => set({ detections: [], dismissed: {} }),
  setAutoMode: (autoMode) => set({ autoMode }),
  setConfidenceThreshold: (confidenceThreshold) =>
    set({ confidenceThreshold }),
}))
