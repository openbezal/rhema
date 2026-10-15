// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SuggestionsPanel } from "./suggestions-panel"
import { useDetectionStore } from "@/stores/detection-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBibleStore } from "@/stores/bible-store"
import type { DetectionResult } from "@/types"

const mocks = vi.hoisted(() => ({ present: vi.fn(), queue: vi.fn() }))
vi.mock("@/lib/suggestion-actions", () => ({
  presentSuggestion: mocks.present,
  queueSuggestion: mocks.queue,
}))
function hit(verse: number): DetectionResult {
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
  }
}
let root: Root, container: HTMLDivElement
async function mount() {
  await act(async () => root.render(<SuggestionsPanel />))
}
function list() {
  return container.querySelector<HTMLElement>(
    '[aria-label="Suggestion results"]'
  )!
}
function card() {
  return container.querySelector<HTMLElement>("[data-suggestion-key]")!
}
async function arrive() {
  await act(async () =>
    useDetectionStore.getState().addDetections([17, 18, 19, 20, 21].map(hit))
  )
}
function applyButton() {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("Apply updates")
  )!
}

describe("stable Suggestions interaction", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    mocks.present.mockReset()
    mocks.queue.mockReset()
    useDetectionStore.getState().clearDetections()
    useSettingsStore.setState({
      suggestionCapacity: 25,
      suggestionRetentionMs: 60_000,
    })
    useBibleStore.setState({
      translations: [
        {
          id: 1,
          abbreviation: "KJV",
          title: "King James",
          language: "en",
          is_copyrighted: false,
          is_downloaded: true,
        },
      ],
    })
    useDetectionStore.getState().addDetections([hit(16)])
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  it("keeps the hovered card and scroll position when five new candidates arrive", async () => {
    await mount()
    const inspected = card()
    list().scrollTop = 72
    await act(async () =>
      inspected.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    )
    await arrive()
    expect(card()).toBe(inspected)
    expect(list().scrollTop).toBe(72)
    expect(container.querySelectorAll("[data-suggestion-key]")).toHaveLength(1)
    expect(applyButton().textContent).toContain("5")
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "5 updates"
    )
    expect(mocks.present).not.toHaveBeenCalled()
    const present = [...inspected.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Present"
    )!
    await act(async () => present.click())
    expect(mocks.present.mock.calls[0][0].verse).toBe(16)
  })
  it("applies pending ranking only on the operator's action", async () => {
    await mount()
    await arrive()
    expect(card().textContent).toContain("John 3:16")
    await act(async () => applyButton().click())
    expect(card().textContent).toContain("John 3:17")
    expect(container.querySelectorAll("[data-suggestion-key]")).toHaveLength(6)
  })
  it("retains an expired card while its controls have keyboard focus", async () => {
    useSettingsStore.setState({ suggestionRetentionMs: 1_000 })
    await mount()
    const inspected = card()
    await act(async () => inspected.querySelector("button")!.focus())
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(card()).toBe(inspected)
    await act(async () => inspected.querySelector("button")!.blur())
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(container.querySelectorAll("[data-suggestion-key]")).toHaveLength(0)
  })
  it("retains the held pointer target after leaving the panel until release", async () => {
    useSettingsStore.setState({ suggestionRetentionMs: 1_000 })
    await mount()
    const inspected = card()
    await act(async () =>
      inspected.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    )
    await arrive()
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(card()).toBe(inspected)
    await act(async () =>
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }))
    )
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(container.querySelectorAll("[data-suggestion-key]")).toHaveLength(0)
  })
  it("keeps a scrolling snapshot stable through arrivals and expiry", async () => {
    useSettingsStore.setState({ suggestionRetentionMs: 1_000 })
    await mount()
    const inspected = card()
    await act(async () => vi.advanceTimersByTime(900))
    list().scrollTop = 96
    await act(async () =>
      list().dispatchEvent(new Event("scroll", { bubbles: true }))
    )
    await arrive()
    await act(async () => vi.advanceTimersByTime(200))
    expect(card()).toBe(inspected)
    expect(list().scrollTop).toBe(96)
    await act(async () => vi.advanceTimersByTime(50))
    await act(async () => vi.advanceTimersByTime(1_000))
    expect(container.querySelectorAll("[data-suggestion-key]")).toHaveLength(0)
  })
  it("labels keyword scores truthfully without a fabricated percentage", async () => {
    await mount()
    expect(card().textContent).toContain("Keyword search")
    expect(card().textContent).toContain("KJV")
    expect(card().textContent).not.toMatch(/75%|cosine|semantic/i)
  })
  it("cleans its expiry and scrolling timers when hidden", async () => {
    await mount()
    await act(async () =>
      list().dispatchEvent(new Event("scroll", { bubbles: true }))
    )
    await act(async () => root.render(null))
    expect(vi.getTimerCount()).toBe(0)
  })
})
