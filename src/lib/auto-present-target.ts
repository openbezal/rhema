import type { DetectionResult } from "@/types"

/**
 * Choose which detection in a batch drives the preview / auto-live display.
 *
 * Takes the detector's most confident reading rather than whichever landed
 * first in the batch. One utterance can yield several direct detections, and
 * batch order is emission order — in issue #152 a spurious match was emitted
 * ahead of the verse the preacher actually named, so the wrong one went on air.
 *
 * References the operator has dismissed are skipped (issue #149): a dismissed
 * detection that still auto-presents would make the dismiss cosmetic.
 */
export function pickAutoPresentTarget(
  detections: DetectionResult[],
  isDismissed: (verseRef: string) => boolean
): DetectionResult | undefined {
  return detections
    .filter(
      (d) =>
        d.source === "direct" && !d.is_chapter_only && !isDismissed(d.verse_ref)
    )
    .reduce<DetectionResult | undefined>(
      (best, d) => (best && best.confidence >= d.confidence ? best : d),
      undefined
    )
}
