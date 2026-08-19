import { describe, expect, it } from "vitest"
import { pickAutoPresentTarget } from "./auto-present-target"
import type { DetectionResult } from "@/types"

function detection(overrides: Partial<DetectionResult>): DetectionResult {
  return {
    verse_ref: "John 3:16",
    verse_text: "For God so loved the world",
    book_name: "John",
    book_number: 43,
    chapter: 3,
    verse: 16,
    confidence: 0.9,
    source: "direct",
    auto_queued: false,
    transcript_snippet: "",
    is_chapter_only: false,
    ...overrides,
  }
}

const nothingDismissed = () => false

describe("pickAutoPresentTarget", () => {
  it("picks the most confident direct detection, not the first emitted", () => {
    const target = pickAutoPresentTarget(
      [
        detection({ verse_ref: "Psalm 1:1", confidence: 0.82 }),
        detection({ verse_ref: "Psalm 136:1", confidence: 0.97 }),
      ],
      nothingDismissed
    )

    expect(target?.verse_ref).toBe("Psalm 136:1")
  })

  it("ignores semantic detections", () => {
    const target = pickAutoPresentTarget(
      [detection({ verse_ref: "Isaiah 53:5", source: "semantic", confidence: 1.0 })],
      nothingDismissed
    )

    expect(target).toBeUndefined()
  })

  it("ignores chapter-only detections", () => {
    const target = pickAutoPresentTarget(
      [detection({ verse_ref: "Psalm 23", is_chapter_only: true, confidence: 1.0 })],
      nothingDismissed
    )

    expect(target).toBeUndefined()
  })

  it("skips a dismissed reference and falls back to the next best", () => {
    const target = pickAutoPresentTarget(
      [
        detection({ verse_ref: "Psalm 136:1", confidence: 0.97 }),
        detection({ verse_ref: "Psalm 1:1", confidence: 0.82 }),
      ],
      (verseRef) => verseRef === "Psalm 136:1"
    )

    expect(target?.verse_ref).toBe("Psalm 1:1")
  })

  it("returns nothing when every direct detection is dismissed", () => {
    const target = pickAutoPresentTarget(
      [detection({ verse_ref: "Psalm 136:1", confidence: 0.97 })],
      () => true
    )

    expect(target).toBeUndefined()
  })

  it("returns nothing for an empty batch", () => {
    expect(pickAutoPresentTarget([], nothingDismissed)).toBeUndefined()
  })
})
