// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import { SessionArchivePanel } from "./session-archive-panel"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useDetectionStore } from "@/stores/detection-store"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"

const saved = {
  kind: "rhema-session-archive",
  version: 1,
  title: "Saved Sunday",
  createdAt: 3000,
  transcript: [{ text: "Saved words Ọlọ́run", timestamp: 1000, confidence: 1 }],
  queue: [],
  detections: [],
  suggestions: [],
  detectionScope: "current-snapshot",
  preferences: {
    settings: {
      gain: 1,
      autoMode: false,
      confidenceThreshold: 0.8,
      cooldownMs: 2500,
      suggestionCapacity: 25,
      suggestionRetentionMs: 60_000,
      sttProvider: "deepgram",
    },
    primaryTranslationCode: "KJV",
    secondaryTranslationCode: null,
    followDetections: false,
    autoLive: false,
    customThemes: [],
  },
}
let root: Root
let container: HTMLDivElement
function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find(
    (item) =>
      item.getAttribute("aria-label") === label || item.textContent === label
  )
  if (!element) throw new Error(`Missing button ${label}`)
  return element
}
async function click(label: string) {
  await act(async () => {
    button(label).click()
  })
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  native.invoke.mockReset()
  useTranscriptStore.setState({
    segments: [
      {
        id: "current",
        text: "Current transcript",
        timestamp: 1000,
        confidence: 1,
        words: [],
        is_final: true,
      },
    ],
    currentPartial: "unfinished",
  })
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES],
    isLive: true,
    liveVerse: { reference: "Current Live", segments: [{ text: "Stay live" }] },
  })
  useBibleStore.setState({
    activeTranslationCode: "KJV",
    secondaryTranslationCode: null,
  })
  useQueueStore.getState().clearQueue()
  useDetectionStore.getState().clearDetections()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<SessionArchivePanel />))
  await click("Session archive")
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it("reports cancelled export without a false success receipt", async () => {
  native.invoke.mockResolvedValue(false)
  await click("Export session JSON")
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Export cancelled."
  )
  expect(button("Export session JSON").disabled).toBe(false)
})
it("reports an actual save and displays write errors", async () => {
  native.invoke
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error("Disk full"))
  await click("Export transcript TXT")
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Saved transcript TXT."
  )
  await click("Export preferences JSON")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Disk full"
  )
})
it("opens a reference archive and keeps current transcript, Queue and Live unchanged", async () => {
  const transcript = useTranscriptStore.getState().segments
  const queue = useQueueStore.getState().items
  const live = useBroadcastStore.getState().liveVerse
  native.invoke.mockResolvedValue({
    name: "saved.json",
    text: JSON.stringify(saved),
  })
  await click("Open saved archive")
  expect(document.body.textContent).toContain("Saved Sunday")
  expect(document.body.textContent).toContain("Saved words Ọlọ́run")
  expect(useTranscriptStore.getState().segments).toBe(transcript)
  expect(useQueueStore.getState().items).toBe(queue)
  expect(useBroadcastStore.getState().liveVerse).toBe(live)
  expect(useBroadcastStore.getState().isLive).toBe(true)
})
it("retains the previously opened archive after malformed import and cancellation", async () => {
  native.invoke
    .mockResolvedValueOnce({ name: "saved.json", text: JSON.stringify(saved) })
    .mockResolvedValueOnce({
      name: "future.json",
      text: JSON.stringify({ ...saved, version: 99 }),
    })
    .mockResolvedValueOnce(null)
  await click("Open saved archive")
  await click("Open saved archive")
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.body.textContent).toContain("Saved Sunday")
  await click("Open saved archive")
  expect(document.querySelector('[role="status"]')?.textContent).toBe(
    "Open cancelled."
  )
  expect(document.body.textContent).toContain("Saved Sunday")
})
it("blocks duplicate file actions while a dialog is pending", async () => {
  let release!: (value: boolean) => void
  native.invoke.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve
      })
  )
  await click("Export session JSON")
  expect(button("Export preferences JSON").disabled).toBe(true)
  expect(button("Open saved archive").disabled).toBe(true)
  await act(async () => {
    release(false)
  })
  expect(button("Open saved archive").disabled).toBe(false)
})

it("explains that a future document requires a compatible Rhema version", async () => {
  native.invoke.mockResolvedValue({
    name: "future.json",
    text: JSON.stringify({ ...saved, version: 99 }),
  })
  await click("Open saved archive")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "not supported"
  )
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Rhema version"
  )
})

it("shows saved portable settings for review without applying them", async () => {
  native.invoke.mockResolvedValue({
    name: "saved.json",
    text: JSON.stringify(saved),
  })
  await click("Open saved archive")
  const values = Object.fromEntries(
    [...document.querySelectorAll("dl dt")].map((label) => [
      label.textContent,
      label.nextElementSibling?.textContent,
    ])
  )
  expect(values).toMatchObject({
    "Input gain": "1×",
    "Detection threshold": "80%",
    "Detection cooldown": "2500 ms",
    "Quotation history capacity": "25",
    "Quotation retention": "60 s",
    "Automatic detection": "Disabled",
    "Follow detections": "Disabled",
    "Auto live": "Disabled",
  })
})
it("closes its modal and restores keyboard focus to the Session trigger", async () => {
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click("Close")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button("Session archive"))
  )
})
