import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  inspect: vi.fn(),
  config: vi.fn(),
  nativeCallback: undefined as
    ((event: { payload: { outputId?: string } }) => void) | undefined,
  callback: undefined as
    ((event: { payload: { outputId?: string } }) => void) | undefined,
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("./broadcast-output-control", () => ({
  inspectOutput: mocks.inspect,
  syncNdiConfigToOutput: mocks.config,
  outputRuntimeVersion: () => 0,
}))
import { connectBroadcastOutputs } from "./broadcast-output-session"
import { useBroadcastStore } from "@/stores/broadcast-store"
const cleanups: (() => void)[] = []
const originalSync = useBroadcastStore.getState().syncBroadcastOutputFor
beforeEach(() => {
  vi.useFakeTimers()
  useBroadcastStore.setState({
    syncBroadcastOutputFor: originalSync,
    outputStatus: {},
  })
  mocks.listen.mockImplementation((_name, callback) => {
    if (_name === "broadcast:native-output-status")
      mocks.nativeCallback = callback
    else mocks.callback = callback
    return Promise.resolve(vi.fn())
  })
  mocks.inspect.mockReset().mockResolvedValue({
    status: { previewOpen: false, ndiActive: false },
    hasWindow: false,
    uncertain: false,
  })
  mocks.config.mockClear()
  vi.spyOn(
    useBroadcastStore.getState(),
    "syncBroadcastOutputFor"
  ).mockImplementation(() => {})
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
  vi.restoreAllMocks()
  vi.useRealTimers()
})
describe("app-owned output readiness", () => {
  it("reconciles surviving senders after subscriptions are registered without needing output-ready", async () => {
    mocks.inspect.mockResolvedValue({
      status: { previewOpen: false, ndiActive: true },
      hasWindow: true,
      uncertain: false,
    })
    cleanups.push(connectBroadcastOutputs())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const state = useBroadcastStore.getState(),
      output = state.outputs[0]
    expect(state.outputStatus[output.id].ndiActive).toBe(true)
    expect(mocks.config).toHaveBeenCalledWith(output, true)
    expect(state.syncBroadcastOutputFor).toHaveBeenCalledOnce()
  })
  it("reconciles a native start finishing after the previous main window was destroyed", async () => {
    cleanups.push(connectBroadcastOutputs())
    for (let i = 0; i < 10; i++) await Promise.resolve()
    mocks.inspect.mockResolvedValue({
      status: { previewOpen: false, ndiActive: true },
      hasWindow: true,
      uncertain: false,
    })
    const output = useBroadcastStore.getState().outputs[0]
    mocks.nativeCallback?.({ payload: { outputId: output.id } })
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(useBroadcastStore.getState().outputStatus[output.id].ndiActive).toBe(
      true
    )
    expect(mocks.config).toHaveBeenCalledWith(output, true)
  })
  it("synchronizes once immediately and once after paint, using current content", async () => {
    cleanups.push(connectBroadcastOutputs())
    await Promise.resolve()
    const id = useBroadcastStore.getState().outputs[0].id
    mocks.callback?.({ payload: { outputId: id } })
    expect(
      useBroadcastStore.getState().syncBroadcastOutputFor
    ).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(150)
    expect(
      useBroadcastStore.getState().syncBroadcastOutputFor
    ).toHaveBeenCalledTimes(2)
  })
  it("ignores callbacks and disposes registrations arriving after unmount", async () => {
    let resolve!: (stop: () => void) => void
    mocks.listen.mockImplementation((_name, callback) => {
      mocks.callback = callback
      return new Promise<() => void>((done) => {
        resolve = done
      })
    })
    const stop = connectBroadcastOutputs()
    stop()
    const dispose = vi.fn()
    resolve(dispose)
    await Promise.resolve()
    mocks.callback?.({ payload: {} })
    await vi.runAllTimersAsync()
    expect(dispose).toHaveBeenCalledOnce()
    expect(
      useBroadcastStore.getState().syncBroadcastOutputFor
    ).not.toHaveBeenCalled()
  })
  it("bounds repeated-ready timers and cancels them on cleanup", async () => {
    const stop = connectBroadcastOutputs()
    cleanups.push(stop)
    await Promise.resolve()
    const id = useBroadcastStore.getState().outputs[0].id
    for (let i = 0; i < 100; i++)
      mocks.callback?.({ payload: { outputId: id } })
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
it("allows explicit recovery clear after the orphan sender has been stopped", async () => {
  mocks.inspect.mockResolvedValue({
    status: { previewOpen: false, ndiActive: true },
    hasWindow: false,
    uncertain: false,
  })
  cleanups.push(connectBroadcastOutputs())
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(useBroadcastStore.getState().presentationRecovery).toBe("unknown")
  mocks.inspect.mockResolvedValue({
    status: { previewOpen: false, ndiActive: false },
    hasWindow: false,
    uncertain: false,
  })
  mocks.nativeCallback?.({
    payload: { outputId: useBroadcastStore.getState().outputs[0].id },
  })
  for (let i = 0; i < 10; i++) await Promise.resolve()
  useBroadcastStore.getState().setLiveVerse(null, null, "black")
  expect(useBroadcastStore.getState()).toMatchObject({
    presentationRecovery: "ready",
    clearMode: "black",
  })
})
