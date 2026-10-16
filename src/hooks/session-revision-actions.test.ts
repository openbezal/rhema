import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
it("waits for native session ownership before starting a provider", async () => {
  let finish!: (revision: number) => void
  mocks.invoke.mockImplementation(async (command) =>
    command === "read_operator_session_revision"
      ? new Promise<number>((resolve) => {
          finish = resolve
        })
      : command === "read_transcription_start_revision"
        ? 0
        : undefined
  )
  const { transcriptionActions } = await import("./use-transcription")
  const job = transcriptionActions.start()
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("read_operator_session_revision")
  )
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "start_transcription",
    expect.anything()
  )
  finish(3)
  await job
  expect(mocks.invoke).toHaveBeenCalledWith(
    "start_transcription",
    expect.anything()
  )
})
it("refuses provider start when the native session revision is unreadable", async () => {
  mocks.invoke.mockRejectedValue(new Error("native unavailable"))
  const { transcriptionActions } = await import("./use-transcription")
  await transcriptionActions.start()
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  expect(mocks.invoke).toHaveBeenCalledWith("read_operator_session_revision")
  expect(mocks.error).toHaveBeenCalledOnce()
})
it("does not ingest or even dispatch a manual detection across maintenance", async () => {
  let finish!: (results: unknown[]) => void
  mocks.invoke.mockImplementation(async (command) =>
    command === "read_operator_session_revision"
      ? 0
      : new Promise<unknown[]>((resolve) => {
          finish = resolve
        })
  )
  const { detectionActions } = await import("./use-detection")
  const { beginOperatorMaintenance } =
    await import("@/lib/operator-maintenance")
  const { useDetectionStore } = await import("@/stores/detection-store")
  const job = detectionActions.detectVerses("John 3:16")
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("detect_verses", {
      text: "John 3:16",
      expectedSessionRevision: 0,
    })
  )
  const lease = beginOperatorMaintenance()
  await detectionActions.detectVerses("Mark 2:5")
  lease.release()
  finish([{ verse_ref: "old", source: "direct" }])
  await expect(job).resolves.toEqual([])
  expect(useDetectionStore.getState().detections).toEqual([])
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "detect_verses",
    expect.objectContaining({ text: "Mark 2:5" })
  )
})
