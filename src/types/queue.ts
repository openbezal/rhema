import type { Verse } from "./bible"

export interface QueueItem {
  id: string
  verse: Verse
  reference: string
  /** Stable source identity for verified suggestion text. */
  translation_code?: string
  confidence: number
  source: "manual" | "ai-direct" | "ai-semantic" | "ai-cloud"
  added_at: number
  /** True when queued from a chapter-only detection (verse defaults to 1, may be refined). */
  is_chapter_only?: boolean
}
