import type { DetectionResult } from "@/types"

export type SuggestionInput = DetectionResult & {
  translation_id: number
  translation_code: string
  score_kind: "reference" | "fts_rank" | "cosine" | "hybrid" | "unknown"
}
export function detectionCandidate(item: DetectionResult): SuggestionInput {
  return {
    ...item,
    translation_code: item.translation_code?.trim().toUpperCase() || "UNKNOWN",
    translation_id: item.translation_id ?? 0,
    score_kind: item.score_kind ?? "unknown",
  }
}
export interface SuggestionCandidate extends SuggestionInput {
  firstSeenAt: number
  lastSeenAt: number
}
export interface SuggestionHistoryOptions {
  capacity: number
  retentionMs: number
}
export const DEFAULT_SUGGESTION_OPTIONS: SuggestionHistoryOptions = {
  capacity: 25,
  retentionMs: 60_000,
}
export function suggestionKey(candidate: SuggestionInput): string {
  return `${candidate.source}|${candidate.translation_code.trim().toUpperCase()}|${candidate.book_number}:${candidate.chapter}:${candidate.verse}`
}
export function suggestionOptions(
  options: SuggestionHistoryOptions
): SuggestionHistoryOptions {
  return {
    capacity: Number.isFinite(options.capacity)
      ? Math.min(100, Math.max(1, Math.trunc(options.capacity)))
      : DEFAULT_SUGGESTION_OPTIONS.capacity,
    retentionMs: Number.isFinite(options.retentionMs)
      ? Math.min(300_000, Math.max(1_000, options.retentionMs))
      : DEFAULT_SUGGESTION_OPTIONS.retentionMs,
  }
}

/** New batches retain backend relevance order; unrefreshed history follows them.
 * Neither synthetic FTS confidence nor a display snapshot determines this history.
 */
export function mergeSuggestionHistory(
  existing: readonly SuggestionCandidate[],
  incoming: readonly SuggestionInput[],
  nowMs: number,
  configured: SuggestionHistoryOptions = DEFAULT_SUGGESTION_OPTIONS
): SuggestionCandidate[] {
  const { capacity, retentionMs } = suggestionOptions(configured)
  const retained = existing.filter(
    (item) => nowMs - item.lastSeenAt < retentionMs
  )
  const previous = new Map(retained.map((item) => [suggestionKey(item), item]))
  const seen = new Set<string>()
  const next: SuggestionCandidate[] = []
  for (const item of incoming) {
    if (next.length === capacity) break
    const key = suggestionKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push({
      ...item,
      translation_code: item.translation_code.trim().toUpperCase(),
      firstSeenAt: previous.get(key)?.firstSeenAt ?? nowMs,
      lastSeenAt: nowMs,
    })
  }
  for (const item of retained) {
    if (next.length === capacity) break
    const key = suggestionKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(item)
  }
  return next
}
export function dismissSuggestion(
  existing: readonly SuggestionCandidate[],
  key: string
): SuggestionCandidate[] {
  return existing.filter((item) => suggestionKey(item) !== key)
}
