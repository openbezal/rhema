import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  callback: undefined as
    ((event: { payload: { outputId?: string } }) => void) | undefined,
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import { connectBroadcastOutputs } from "./broadcast-output-session"
import { useBroadcastStore } from "@/stores/broadcast-store"
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  mocks.listen.mockImplementation((_name, callback) => {
    mocks.callback = callback
    return Promise.resolve(vi.fn())
  })
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
