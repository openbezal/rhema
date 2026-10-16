// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const actions = vi.hoisted(() => ({
  present: vi.fn(),
  queue: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock("@/hooks/use-broadcast", () => ({ presentVerse: actions.present }))
vi.mock("@/hooks/use-bible", () => ({
  bibleActions: { navigateToVerse: actions.navigate },
}))
vi.mock("@/lib/suggestion-actions", () => ({ queueSuggestion: actions.queue }))
import { DetectionsPanel } from "./detections-panel"
import { useDetectionStore } from "@/stores/detection-store"
import { beginOperatorMaintenance } from "@/lib/operator-maintenance"
import type { DetectionResult } from "@/types"
const hit: DetectionResult = {
  book_number: 43,
  book_name: "John",
  chapter: 3,
  verse: 16,
  verse_ref: "John 3:16",
  verse_text: "Verified",
  confidence: 1,
  source: "direct",
  translation_code: "KJV",
  auto_queued: false,
  transcript_snippet: "John three sixteen",
  is_chapter_only: false,
}
let root: Root, host: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  )
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  actions.present.mockReset()
  actions.queue.mockReset().mockResolvedValue(true)
  actions.navigate.mockReset()
  useDetectionStore.getState().clearDetections()
  useDetectionStore.getState().addDetections([hit])
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<DetectionsPanel />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it.each([false, true])(
  "rejects retained detection/header controls across reset, including a busy render=%s",
  async (busyRender) => {
    let lease: ReturnType<typeof beginOperatorMaintenance> | undefined
    if (busyRender)
      await act(async () => {
        lease = beginOperatorMaintenance()
      })
    const oldButtons = [...host.querySelectorAll<HTMLButtonElement>("button")]
    await act(async () => {
      lease ??= beginOperatorMaintenance()
      useDetectionStore.getState().clearDetections()
      lease.release()
      useDetectionStore.getState().addDetections([hit])
      for (const button of oldButtons) button.click()
    })
    expect(actions.present).not.toHaveBeenCalled()
    expect(actions.navigate).not.toHaveBeenCalled()
    expect(actions.queue).not.toHaveBeenCalled()
    expect(useDetectionStore.getState().detections).toHaveLength(1)
  }
)
