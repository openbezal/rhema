import { beforeEach, describe, expect, it } from "vitest"
import { useDetectionStore } from "./detection-store"
import type { DetectionResult } from "@/types"

function detection(overrides: Partial<DetectionResult>): DetectionResult {
  return {
    verse_ref: "John 3:16",
    verse_text: "For God so loved the world",
    book_name: "John",
    book_number: 43,
    chapter: 3,
    verse: 16,
    confidence: 0.75,
    source: "semantic",
    auto_queued: false,
    transcript_snippet: "",
    is_chapter_only: false,
    ...overrides,
  }
}

describe("detection store addDetections", () => {
  beforeEach(() => {
    useDetectionStore.setState({ detections: [] })
  })

  it("replaces the previous semantic batch with the new one", () => {
    const store = useDetectionStore.getState()
    store.addDetections([
      detection({ verse_ref: "Hebrews 13:25", confidence: 0.75 }),
      detection({ verse_ref: "Isaiah 53:5", confidence: 0.71 }),
    ])
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Romans 3:1", confidence: 0.75 }),
      detection({ verse_ref: "1 Corinthians 9:20", confidence: 0.71 }),
    ])

    const semantic = useDetectionStore
      .getState()
      .detections.filter((d) => d.source === "semantic")
    expect(semantic.map((d) => d.verse_ref)).toEqual([
      "Romans 3:1",
      "1 Corinthians 9:20",
    ])
  })

  it("keeps semantic batch in backend rank order, not confidence-resorted", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Romans 3:1", confidence: 0.71 }),
      detection({ verse_ref: "1 Corinthians 9:20", confidence: 0.75 }),
    ])

    const refs = useDetectionStore.getState().detections.map((d) => d.verse_ref)
    expect(refs).toEqual(["Romans 3:1", "1 Corinthians 9:20"])
  })

  it("preserves direct detection history across semantic batches", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Hebrews 12:14", source: "direct", confidence: 1.0 }),
    ])
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Romans 3:1", confidence: 0.75 }),
    ])

    const detections = useDetectionStore.getState().detections
    expect(detections.some((d) => d.verse_ref === "Hebrews 12:14")).toBe(true)
    expect(detections.some((d) => d.verse_ref === "Romans 3:1")).toBe(true)
  })

  it("keeps the previous semantic batch when a direct-only batch arrives", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Romans 3:1", confidence: 0.75 }),
    ])
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Hebrews 12:14", source: "direct", confidence: 1.0 }),
    ])

    const semantic = useDetectionStore
      .getState()
      .detections.filter((d) => d.source === "semantic")
    expect(semantic.map((d) => d.verse_ref)).toEqual(["Romans 3:1"])
  })

  it("dedups direct detections by reference, newest first", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Hebrews 12:14", source: "direct", confidence: 0.9 }),
      detection({ verse_ref: "John 3:16", source: "direct", confidence: 0.95 }),
    ])
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Hebrews 12:14", source: "direct", confidence: 1.0 }),
    ])

    const direct = useDetectionStore
      .getState()
      .detections.filter((d) => d.source === "direct")
    expect(direct.map((d) => d.verse_ref)).toEqual(["Hebrews 12:14", "John 3:16"])
    expect(direct[0].confidence).toBe(1.0)
  })
})
