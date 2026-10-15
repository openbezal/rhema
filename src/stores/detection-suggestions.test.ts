import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDetectionStore } from "./detection-store"
import { useSettingsStore } from "./settings-store"
import { suggestionKey } from "@/lib/suggestion-history"
import type { DetectionResult } from "@/types"

function hit(
  verse: number,
  overrides: Partial<DetectionResult> = {}
): DetectionResult {
  return {
    verse_ref: `John 3:${verse}`,
    verse_text: `Fixture text ${verse}`,
    book_name: "John",
    book_number: 43,
    chapter: 3,
    verse,
    source: "semantic",
    confidence: 0.75,
    auto_queued: false,
    transcript_snippet: "Fixture quote",
    is_chapter_only: false,
    translation_code: "KJV",
    translation_id: 1,
    score_kind: "fts_rank",
    ...overrides,
  }
}
describe("suggestion ingestion", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    useDetectionStore.getState().clearDetections()
    useSettingsStore.setState({
      suggestionCapacity: 25,
      suggestionRetentionMs: 60_000,
    })
  })
  afterEach(() => vi.useRealTimers())
  it("retains earlier semantic candidates across batches independently of direct history", () => {
    useDetectionStore.getState().addDetections([hit(16)])
    useDetectionStore
      .getState()
      .addDetections([hit(17), hit(18, { source: "direct" })])
    expect(
      useDetectionStore.getState().suggestions.map((item) => item.verse)
    ).toEqual([17, 16])
    expect(
      useDetectionStore
        .getState()
        .detections.some((item) => item.source === "direct")
    ).toBe(true)
  })
  it("keeps packet translation identity and distinguishes aliases from another translation", () => {
    useDetectionStore
      .getState()
      .addDetections([
        hit(16),
        hit(16, { translation_code: "ESV", translation_id: 2 }),
      ])
    useDetectionStore
      .getState()
      .addDetections([hit(16, { verse_ref: "St John 3:16" })])
    expect(
      useDetectionStore
        .getState()
        .suggestions.map((item) => item.translation_code)
    ).toEqual(["KJV", "ESV"])
  })
  it("suppresses a dismissed canonical candidate through immediate reranking", () => {
    useDetectionStore.getState().addDetections([hit(16)])
    const key = suggestionKey(useDetectionStore.getState().suggestions[0])
    useDetectionStore.getState().dismissSuggestion(key)
    useDetectionStore
      .getState()
      .addDetections([hit(16, { verse_ref: "St John 3:16" })])
    expect(useDetectionStore.getState().suggestions).toEqual([])
    vi.advanceTimersByTime(10_001)
    useDetectionStore.getState().addDetections([hit(16)])
    expect(useDetectionStore.getState().suggestions).toHaveLength(1)
  })
  it("expires and bounds history using configured retention and capacity", () => {
    useSettingsStore.setState({
      suggestionCapacity: 3,
      suggestionRetentionMs: 2_000,
    })
    useDetectionStore.getState().addDetections([hit(1), hit(2), hit(3), hit(4)])
    expect(useDetectionStore.getState().suggestions).toHaveLength(3)
    vi.advanceTimersByTime(2_000)
    useDetectionStore.getState().pruneSuggestions()
    expect(useDetectionStore.getState().suggestions).toEqual([])
  })
  it("marks legacy unattributed packets as unknown instead of guessing their translation", () => {
    useDetectionStore.getState().addDetections([
      hit(16, {
        translation_id: null,
        translation_code: null,
        score_kind: undefined,
      }),
    ])
    expect(useDetectionStore.getState().suggestions[0]).toMatchObject({
      translation_code: "UNKNOWN",
      translation_id: 0,
      score_kind: "unknown",
    })
  })
  it("clear removes history and its suppression together", () => {
    useDetectionStore.getState().addDetections([hit(16)])
    useDetectionStore
      .getState()
      .dismissSuggestion(
        suggestionKey(useDetectionStore.getState().suggestions[0])
      )
    useDetectionStore.getState().clearDetections()
    useDetectionStore.getState().addDetection(hit(16))
    expect(useDetectionStore.getState().suggestions).toHaveLength(1)
  })
})
