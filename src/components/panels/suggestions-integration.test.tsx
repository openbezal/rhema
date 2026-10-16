// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import { SuggestionsPanel } from "@/components/panels/suggestions-panel"
import { useDetectionStore } from "@/stores/detection-store"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { clearLive } from "@/lib/presentation-controller"
it("a committed suggestion should release its controls before optional lookup completes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const primary = {
    id: 16,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "Primary text",
  }
  let release!: (value: unknown) => void
  const optional = new Promise<unknown>((r) => (release = r))
  mocks.invoke.mockImplementation(
    (command: string, args: { translationId: number }) =>
      command === "get_verse"
        ? args.translationId === 1
          ? Promise.resolve(primary)
          : optional
        : Promise.resolve()
  )
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    secondaryTranslationCode: "BSRK",
    translationSelectionStatus: "ready",
    translations: [1, 2].map((id) => ({
      id,
      abbreviation: id === 1 ? "KJV" : "BSRK",
      title: "Fixture",
      language: "en",
      is_downloaded: true,
      is_copyrighted: false,
    })),
  })
  useBroadcastStore.setState({
    presentationRecovery: "ready",
    outputStatus: {},
    isLive: true,
    liveVerse: null,
    liveSourceVerse: null,
  })
  useQueueStore.getState().clearQueue()
  useDetectionStore.getState().clearDetections()
  useDetectionStore
    .getState()
    .addDetections([
      {
        verse_ref: "John 3:16",
        verse_text: primary.text,
        book_name: "John",
        book_number: 43,
        chapter: 3,
        verse: 16,
        source: "semantic",
        confidence: 0.75,
        auto_queued: false,
        transcript_snippet: "quote",
        is_chapter_only: false,
        translation_code: "KJV",
        translation_id: 1,
        score_kind: "fts_rank",
      },
    ])
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<SuggestionsPanel />))
    const present = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Present"
    )!
    await act(async () => {
      present.click()
      for (let i = 0; i < 15; i++) await Promise.resolve()
    })
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(primary)
    expect(present.disabled).toBe(false)
    await act(async () => clearLive("black"))
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(
      present.disabled,
      "primary committed and Clear completed, but same suggestion cannot be re-presented"
    ).toBe(false)
    const queue = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Queue"
    )!
    expect(queue.disabled).toBe(false)
    await act(async () => {
      queue.click()
      for (let i = 0; i < 15; i++) await Promise.resolve()
    })
    expect(useQueueStore.getState().items).toHaveLength(1)
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  } finally {
    await act(async () => {
      release({ ...primary, translation_id: 2, text: "Optional" })
      for (let i = 0; i < 15; i++) await Promise.resolve()
    })
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
  expect(useBroadcastStore.getState().liveVerse).toBeNull()
})
