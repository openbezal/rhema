import { describe, expect, it } from "vitest"
import {
  mergeSuggestionHistory,
  dismissSuggestion,
  suggestionKey,
  type SuggestionInput,
} from "./suggestion-history"

const options = { capacity: 25, retentionMs: 60_000 }
function candidate(
  verse: number,
  overrides: Partial<SuggestionInput> = {}
): SuggestionInput {
  return {
    source: "semantic",
    translation_code: "KJV",
    translation_id: 1,
    score_kind: "fts_rank",
    book_number: 43,
    chapter: 3,
    verse,
    book_name: "John",
    verse_ref: `John 3:${verse}`,
    verse_text: `Fixture verse ${verse}`,
    confidence: 0.75,
    auto_queued: false,
    transcript_snippet: "Fixture quote",
    is_chapter_only: false,
    ...overrides,
  }
}

describe("bounded suggestion history", () => {
  it("appends distinct batches without losing earlier candidates", () => {
    const first = mergeSuggestionHistory(
      [],
      [candidate(16), candidate(17)],
      0,
      options
    )
    const next = mergeSuggestionHistory(first, [candidate(18)], 1_000, options)
    expect(next.map((item) => item.verse)).toEqual([18, 16, 17])
    expect(first.map((item) => item.verse)).toEqual([16, 17])
  })
  it("dedupes aliases by canonical source, translation code and coordinates", () => {
    const first = candidate(16)
    const alias = candidate(16, {
      verse_ref: "St John 3:16",
      translation_code: " kjv ",
      translation_id: 9,
    })
    expect(suggestionKey(first)).toBe(suggestionKey(alias))
    const next = mergeSuggestionHistory(
      mergeSuggestionHistory([], [first], 0, options),
      [alias],
      1_000,
      options
    )
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      translation_code: "KJV",
      firstSeenAt: 0,
      lastSeenAt: 1_000,
      translation_id: 9,
    })
  })
  it("preserves separate translations and sources for the same verse", () => {
    const next = mergeSuggestionHistory(
      [],
      [
        candidate(16),
        candidate(16, { translation_code: "ESV", translation_id: 2 }),
        candidate(16, { source: "direct" }),
      ],
      0,
      options
    )
    expect(next).toHaveLength(3)
    expect(new Set(next.map(suggestionKey)).size).toBe(3)
  })
  it("refreshes a candidate with current text and rank while keeping its first observation", () => {
    const first = mergeSuggestionHistory(
      [],
      [candidate(16), candidate(17)],
      0,
      options
    )
    const next = mergeSuggestionHistory(
      first,
      [
        candidate(17, {
          confidence: 0.6,
          verse_text: "Refreshed quote context",
        }),
        candidate(18, { confidence: 0.99 }),
      ],
      1_000,
      options
    )
    expect(next.map((item) => item.verse)).toEqual([17, 18, 16])
    expect(next[0]).toMatchObject({
      firstSeenAt: 0,
      lastSeenAt: 1_000,
      verse_text: "Refreshed quote context",
      confidence: 0.6,
    })
  })
  it("dedupes within a batch without manufacturing confidence order", () => {
    const next = mergeSuggestionHistory(
      [],
      [
        candidate(16, { confidence: 0.55 }),
        candidate(17, { confidence: 0.8 }),
        candidate(16),
      ],
      0,
      options
    )
    expect(next.map((item) => item.verse)).toEqual([16, 17])
  })
  it("expires candidates at the retention boundary", () => {
    const first = mergeSuggestionHistory([], [candidate(16)], 0, options)
    expect(mergeSuggestionHistory(first, [], 59_999, options)).toHaveLength(1)
    expect(mergeSuggestionHistory(first, [], 60_000, options)).toEqual([])
  })
  it("refreshing extends retention without extending unrelated candidates", () => {
    const first = mergeSuggestionHistory(
      [],
      [candidate(16), candidate(17)],
      0,
      options
    )
    const refreshed = mergeSuggestionHistory(
      first,
      [candidate(16)],
      50_000,
      options
    )
    expect(
      mergeSuggestionHistory(refreshed, [], 60_000, options).map(
        (item) => item.verse
      )
    ).toEqual([16])
  })
  it("dismisses exactly one canonical candidate without mutating the snapshot", () => {
    const first = mergeSuggestionHistory(
      [],
      [candidate(16), candidate(16, { translation_code: "ESV" })],
      0,
      options
    )
    expect(
      dismissSuggestion(first, suggestionKey(candidate(16))).map(
        (item) => item.translation_code
      )
    ).toEqual(["ESV"])
    expect(first).toHaveLength(2)
  })
  it("enforces capacity after every batch during continuous ingestion", () => {
    let history = mergeSuggestionHistory([], [], 0, options)
    for (let index = 0; index < 1_000; index++) {
      history = mergeSuggestionHistory(
        history,
        Array.from({ length: 5 }, (_, offset) =>
          candidate(index * 5 + offset + 1)
        ),
        index * 10,
        options
      )
      expect(history.length).toBeLessThanOrEqual(25)
    }
    expect(history).toHaveLength(25)
  })
  it("applies a smaller configured bound on the next merge", () => {
    const first = mergeSuggestionHistory(
      [],
      Array.from({ length: 10 }, (_, index) => candidate(index + 1)),
      0,
      options
    )
    expect(
      mergeSuggestionHistory(first, [], 0, { ...options, capacity: 3 })
    ).toHaveLength(3)
  })
})
