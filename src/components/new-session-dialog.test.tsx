// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  export: vi.fn(),
  invoke: vi.fn(),
  recovery: null as unknown,
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/session-reset-controller", async (original) => ({
  ...(await original<typeof import("@/lib/session-reset-controller")>()),
  startNewSession: mocks.start,
  getSessionResetRecoveryArchive: () => mocks.recovery,
}))
vi.mock("@/lib/session-reset-files", () => ({
  exportBeforeNewSession: mocks.export,
}))
import { NewSessionDialog } from "./new-session-dialog"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import { useAudioStore } from "@/stores/audio-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import {
  beginOperatorMaintenance,
  useOperatorMaintenanceStore,
} from "@/lib/operator-maintenance"
import { captureSessionArchive } from "@/lib/session-archive"
let root: Root, host: HTMLDivElement
const button = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text
  )!
async function click(text: string) {
  await act(async () => button(text).click())
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.start.mockReset().mockResolvedValue(undefined)
  mocks.export.mockReset().mockResolvedValue(true)
  mocks.invoke.mockReset().mockResolvedValue(undefined)
  mocks.recovery = null
  useOperatorMaintenanceStore.setState({
    phase: "idle",
    revision: 0,
    message: null,
  })
  useProfileStatusStore.setState({ readFailed: false })
  useBibleStore.setState(useBibleStore.getInitialState())
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    presentationRecovery: "ready",
    isLive: false,
    isDesignerOpen: false,
  })
  useAudioStore.setState(useAudioStore.getInitialState())
  useTranscriptStore.setState({
    ...useTranscriptStore.getInitialState(),
    segments: [
      {
        id: "final",
        text: "Saved Sunday Ọlọ́run",
        is_final: true,
        confidence: 1,
        words: [],
        timestamp: 1,
      },
    ],
    currentPartial: "unfinished",
  })
  useQueueStore.getState().clearQueue()
  useDetectionStore.getState().clearDetections()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<NewSessionDialog />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useOperatorMaintenanceStore.setState({ phase: "idle", message: null })
  vi.unstubAllGlobals()
})
it("reviews counts and retained settings, with no clear before confirmation or after Cancel", async () => {
  const segments = useTranscriptStore.getState().segments,
    trigger = button("New session")
  await click("New session")
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain("1 completed transcript segment")
  expect(dialog.textContent).toContain("partial")
  expect(dialog.textContent).toContain("output assignments")
  expect(mocks.start).not.toHaveBeenCalled()
  await click("Cancel")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(useTranscriptStore.getState().segments).toBe(segments)
  expect(mocks.start).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
})
it("exports independently and never resets after export cancellation or failure", async () => {
  await click("New session")
  mocks.export.mockResolvedValueOnce(false)
  await click("Export session JSON")
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Export cancelled"
  )
  mocks.export.mockRejectedValueOnce(new Error("Synthetic disk full"))
  await click("Export transcript TXT")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not export"
  )
  expect(mocks.start).not.toHaveBeenCalled()
})
it("prevents duplicate confirmation, Escape and closing during a delayed reset", async () => {
  let finish!: () => void
  mocks.start.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  await click("New session")
  await click("Start new session")
  expect(button("Start new session").disabled).toBe(true)
  expect(button("Cancel").disabled).toBe(true)
  expect(document.querySelector('button[data-slot="dialog-close"]')).toBeNull()
  await act(async () =>
    document
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click("Start new session")
  expect(mocks.start).toHaveBeenCalledOnce()
  await act(async () => finish())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain("New session started")
})
it("keeps the review open on a known refusal and allows Cancel", async () => {
  mocks.start.mockRejectedValueOnce(new Error("Stop the audio test first"))
  await click("New session")
  await click("Start new session")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Stop the audio test"
  )
  expect(button("Cancel").disabled).toBe(false)
  expect(useTranscriptStore.getState().segments).toHaveLength(1)
})
it("shows immutable recovery export and explicit reload without allowing another reset", async () => {
  mocks.start.mockImplementationOnce(async () => {
    mocks.recovery = captureSessionArchive("Before reset")
    const lease = beginOperatorMaintenance()
    lease.recoveryRequired("Reset acknowledgement lost. Export before reload.")
    throw new Error("Reset acknowledgement lost")
  })
  await click("New session")
  await click("Start new session")
  expect(button("Reload Rhema")).toBeDefined()
  expect(button("Cancel").disabled).toBe(true)
  expect(
    [...document.querySelectorAll("button")].some(
      (item) => item.textContent?.trim() === "Start new session"
    )
  ).toBe(false)
  await click("Export session JSON")
  expect(mocks.export).toHaveBeenCalledWith("archive")
  expect(mocks.start).toHaveBeenCalledOnce()
})
it("reactively disables confirmation when Live or an audio opening becomes active", async () => {
  await click("New session")
  await act(async () => useBroadcastStore.setState({ isLive: true }))
  expect(button("Start new session").disabled).toBe(true)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Turn Live off"
  )
  await act(async () => {
    useBroadcastStore.setState({ isLive: false })
    useAudioStore.setState({ isTestStarting: true })
  })
  expect(button("Start new session").disabled).toBe(true)
  expect(mocks.start).not.toHaveBeenCalled()
})
