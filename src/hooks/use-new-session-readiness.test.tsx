// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
import { useNewSessionReadiness } from "./use-new-session-readiness"
import {
  transcriptionActions,
  hasPendingTranscriptionChange,
} from "./use-transcription"
import { newSessionBlockedReason } from "@/lib/session-reset-controller"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useAudioStore } from "@/stores/audio-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useProfileStatusStore } from "@/lib/profile-status"
function Probe() {
  return <output>{useNewSessionReadiness() ?? "ready"}</output>
}
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  native.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "read_operator_session_revision" ||
      command === "read_transcription_start_revision"
        ? 0
        : undefined
    )
  useBibleStore.setState(useBibleStore.getInitialState())
  useAudioStore.setState(useAudioStore.getInitialState())
  useTranscriptStore.setState(useTranscriptStore.getInitialState())
  useProfileStatusStore.setState({ readFailed: false })
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    presentationRecovery: "ready",
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it("enables the mounted readiness consumer when a delayed Stop finishes without another store update", async () => {
  let finish!: () => void
  native.invoke.mockImplementation((command) =>
    command === "stop_transcription"
      ? new Promise<void>((resolve) => {
          finish = resolve
        })
      : Promise.resolve(0)
  )
  useTranscriptStore.setState({ isTranscribing: true })
  await act(async () => root.render(<Probe />))
  let job!: Promise<void>
  await act(async () => {
    job = transcriptionActions.stop()
  })
  expect(host.textContent).toContain("Stop transcription")
  await act(async () => {
    finish()
    await job
  })
  expect(hasPendingTranscriptionChange()).toBe(false)
  expect(newSessionBlockedReason()).toBeNull()
  expect(host.textContent).toBe("ready")
})
it("enables the mounted readiness consumer after a delayed Start fails", async () => {
  let fail!: (error: Error) => void
  native.invoke.mockImplementation((command) =>
    command === "start_transcription"
      ? new Promise<void>((_, reject) => {
          fail = reject
        })
      : Promise.resolve(0)
  )
  await act(async () => root.render(<Probe />))
  let job!: Promise<void>
  await act(async () => {
    job = transcriptionActions.start()
  })
  expect(host.textContent).toContain("Stop transcription")
  await act(async () => {
    fail(new Error("Synthetic provider failure"))
    await job
  })
  expect(hasPendingTranscriptionChange()).toBe(false)
  expect(newSessionBlockedReason()).toBeNull()
  expect(host.textContent).toBe("ready")
})
