import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("sonner", () => ({ toast: { error: native.error } }))
beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset()
  native.error.mockReset()
})
async function modules() {
  const { transcriptionActions } = await import("./use-transcription")
  const { useTranscriptStore } = await import("@/stores/transcript-store")
  const maintenance = await import("@/lib/operator-maintenance")
  return { transcriptionActions, useTranscriptStore, ...maintenance }
}

it("does not start or show connecting status during maintenance", async () => {
  const m = await modules()
  const lease = m.beginOperatorMaintenance()
  await m.transcriptionActions.start()
  expect(native.invoke).not.toHaveBeenCalled()
  expect(m.useTranscriptStore.getState().connectionStatus).toBe("disconnected")
  lease.release()
})

it("deduplicates start and sends the native start revision with the current settings", async () => {
  let release!: (value: number) => void
  native.invoke.mockImplementation((command) =>
    command === "read_transcription_start_revision"
      ? new Promise<number>((resolve) => {
          release = resolve
        })
      : Promise.resolve()
  )
  const m = await modules()
  const first = m.transcriptionActions.start()
  const duplicate = m.transcriptionActions.start()
  expect(native.invoke).toHaveBeenCalledTimes(1)
  const { useSettingsStore } = await import("@/stores/settings-store")
  useSettingsStore.getState().setGain(1.75)
  release(8)
  await Promise.all([first, duplicate])
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "start_transcription"
    )
  ).toHaveLength(1)
  expect(native.invoke).toHaveBeenCalledWith(
    "start_transcription",
    expect.objectContaining({ startRevision: 8, gain: 1.75 })
  )
})

it("does not invoke a delayed start after Stop has completed", async () => {
  let release!: (value: number) => void
  native.invoke.mockImplementation((command) =>
    command === "read_transcription_start_revision"
      ? new Promise<number>((resolve) => {
          release = resolve
        })
      : Promise.resolve()
  )
  const m = await modules()
  const start = m.transcriptionActions.start()
  await m.transcriptionActions.stop()
  release(1)
  await start
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "start_transcription"
    )
  ).toHaveLength(0)
  expect(m.useTranscriptStore.getState()).toMatchObject({
    isTranscribing: false,
    connectionStatus: "disconnected",
  })
})

it("ignores an obsolete start completion and error after Stop and a new successful run", async () => {
  let reject!: (error: unknown) => void
  let starts = 0
  native.invoke.mockImplementation((command) => {
    if (command === "read_transcription_start_revision")
      return Promise.resolve(starts)
    if (command === "start_transcription" && starts++ === 0)
      return new Promise<void>((_, fail) => {
        reject = fail
      })
    return Promise.resolve()
  })
  const m = await modules()
  const old = m.transcriptionActions.start()
  await vi.waitFor(() => expect(starts).toBe(1))
  await m.transcriptionActions.stop()
  await m.transcriptionActions.start()
  reject("obsolete provider error")
  await old
  expect(m.useTranscriptStore.getState().isTranscribing).toBe(true)
  expect(m.useTranscriptStore.getState().connectionStatus).not.toBe("error")
  expect(native.error).not.toHaveBeenCalled()
})

it("does not release an old start across maintenance even if its native revision read completes later", async () => {
  let release!: (value: number) => void
  native.invoke.mockImplementation((command) =>
    command === "read_transcription_start_revision"
      ? new Promise<number>((resolve) => {
          release = resolve
        })
      : Promise.resolve()
  )
  const m = await modules()
  const old = m.transcriptionActions.start()
  const lease = m.beginOperatorMaintenance()
  lease.release()
  release(0)
  await old
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "start_transcription"
    )
  ).toHaveLength(0)
})
