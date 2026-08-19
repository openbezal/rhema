import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DISMISS_SUPPRESSION_MS, useDetectionStore } from "./detection-store"
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

describe("detection store dismissDetection", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useDetectionStore.setState({ detections: [], dismissed: {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("removes the dismissed detection from the list", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
      detection({ verse_ref: "John 3:16", source: "direct", confidence: 0.9 }),
    ])

    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    const refs = useDetectionStore.getState().detections.map((d) => d.verse_ref)
    expect(refs).toEqual(["John 3:16"])
  })

  it("leaves the same reference in the other source column", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
      detection({ verse_ref: "Psalm 23:1", source: "semantic", confidence: 0.7 }),
    ])

    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    const remaining = useDetectionStore.getState().detections
    expect(remaining.map((d) => d.source)).toEqual(["semantic"])
  })

  it("suppresses a re-detection of a dismissed reference", () => {
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
    ])
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    vi.advanceTimersByTime(1000)
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
    ])

    expect(useDetectionStore.getState().detections).toEqual([])
  })

  it("allows the reference again once the suppression window expires", () => {
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    vi.advanceTimersByTime(DISMISS_SUPPRESSION_MS)
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
    ])

    const refs = useDetectionStore.getState().detections.map((d) => d.verse_ref)
    expect(refs).toEqual(["Psalm 23:1"])
  })

  it("suppresses only the dismissed source, not the same ref from elsewhere", () => {
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "semantic", confidence: 0.7 }),
    ])

    const refs = useDetectionStore.getState().detections.map((d) => d.verse_ref)
    expect(refs).toEqual(["Psalm 23:1"])
  })

  it("reports whether a reference is currently dismissed", () => {
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    expect(useDetectionStore.getState().isDismissed("Psalm 23:1", "direct")).toBe(true)
    expect(useDetectionStore.getState().isDismissed("Psalm 23:1", "semantic")).toBe(false)

    vi.advanceTimersByTime(DISMISS_SUPPRESSION_MS)
    expect(useDetectionStore.getState().isDismissed("Psalm 23:1", "direct")).toBe(false)
  })

  it("clears suppression when all detections are cleared", () => {
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    useDetectionStore.getState().clearDetections()
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "Psalm 23:1", source: "direct", confidence: 1.0 }),
    ])

    const refs = useDetectionStore.getState().detections.map((d) => d.verse_ref)
    expect(refs).toEqual(["Psalm 23:1"])
  })

  it("drops expired entries from the suppression map", () => {
    useDetectionStore.getState().dismissDetection("Psalm 23:1", "direct")

    vi.advanceTimersByTime(DISMISS_SUPPRESSION_MS)
    useDetectionStore.getState().addDetections([
      detection({ verse_ref: "John 3:16", source: "direct", confidence: 1.0 }),
    ])

    expect(useDetectionStore.getState().dismissed).toEqual({})
  })
})
