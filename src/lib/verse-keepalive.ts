/**
 * Idle-fade keepalive for the live verse.
 *
 * The fade timer re-arms only on a fresh present (VerseRenderData.presentedAt
 * changing). But the preacher can keep talking ABOUT the displayed verse
 * without triggering another present — semantic candidates matching its text,
 * or a chapter-only mention — and the verse should stay up while that lasts.
 *
 * On every detection batch, if any candidate relates to the verse currently
 * on air, re-present it in place with a fresh stamp. When the speech veers
 * away, batches stop matching, the stamp goes stale, and the output fades on
 * schedule. New verses and manual presents restart the clock via presentVerse.
 */

import { useBroadcastStore } from "@/stores/broadcast-store"
import type { DetectionResult, Verse } from "@/types"

/**
 * Does any detection in the batch relate to the displayed verse?
 * Exact verse matches count from any source (direct or semantic — semantic
 * hits mean the spoken text matches the verse's content). A chapter-only
 * detection counts when it names the verse's book + chapter.
 */
export function isRelatedDetection(
  source: Pick<Verse, "book_number" | "chapter" | "verse">,
  detections: DetectionResult[]
): boolean {
  return detections.some((d) => {
    if (d.book_number !== source.book_number) return false
    if (d.chapter !== source.chapter) return false
    return d.is_chapter_only || d.verse === source.verse
  })
}

/**
 * Called from the detection stream. Refreshes the live verse's presentedAt
 * stamp when the batch still relates to it, keeping the idle fade at bay.
 */
export function keepLiveVerseAlive(detections: DetectionResult[]): void {
  const s = useBroadcastStore.getState()
  if (!s.isLive || !s.liveVerse || !s.liveSourceVerse) return
  if (!isRelatedDetection(s.liveSourceVerse, detections)) return
  s.setLiveVerse({ ...s.liveVerse, presentedAt: Date.now() }, s.liveSourceVerse)
}
