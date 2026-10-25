import { describe, expect, it } from "vitest"
import { isRelatedDetection } from "./verse-keepalive"
import type { DetectionResult } from "@/types"

const GEN_1_1 = { book_number: 1, chapter: 1, verse: 1 }

function detection(overrides: Partial<DetectionResult>): DetectionResult {
  return {
    verse_ref: "Genesis 1:1",
    verse_text: "In the beginning God created the heaven and the earth.",
    book_name: "Genesis",
    book_number: 1,
    chapter: 1,
    verse: 1,
    confidence: 0.9,
    source: "direct",
    auto_queued: false,
    transcript_snippet: "",
    is_chapter_only: false,
    ...overrides,
  }
}

describe("isRelatedDetection", () => {
  it("matches an exact direct re-detection of the displayed verse", () => {
    expect(isRelatedDetection(GEN_1_1, [detection({})])).toBe(true)
  })

  it("matches a semantic candidate for the displayed verse", () => {
    expect(
      isRelatedDetection(GEN_1_1, [detection({ source: "semantic", confidence: 0.4 })])
    ).toBe(true)
  })

  it("matches a chapter-only mention of the verse's book and chapter", () => {
    expect(
      isRelatedDetection(GEN_1_1, [detection({ is_chapter_only: true, verse: 5 })])
    ).toBe(true)
  })

  it("does not match a different verse in the same chapter", () => {
    expect(isRelatedDetection(GEN_1_1, [detection({ verse: 3, verse_ref: "Genesis 1:3" })])).toBe(
      false
    )
  })

  it("does not match a different chapter or book", () => {
    expect(isRelatedDetection(GEN_1_1, [detection({ chapter: 2 })])).toBe(false)
    expect(isRelatedDetection(GEN_1_1, [detection({ book_number: 43 })])).toBe(false)
  })

  it("returns false for an empty batch", () => {
    expect(isRelatedDetection(GEN_1_1, [])).toBe(false)
  })

  it("matches when at least one candidate in a mixed batch relates", () => {
    expect(
      isRelatedDetection(GEN_1_1, [
        detection({ book_number: 43, chapter: 3, verse: 16, verse_ref: "John 3:16" }),
        detection({ source: "semantic" }),
      ])
    ).toBe(true)
  })
})
