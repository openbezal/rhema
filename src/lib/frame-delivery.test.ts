import { afterEach, describe, expect, it, vi } from "vitest"
import { LatestFrameDelivery, type CapturedFrame } from "./frame-delivery"
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function frame(value: number): CapturedFrame {
  return { width: 1, height: 1, pixels: new Uint8Array([value, 0, 0, 255]) }
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
afterEach(() => vi.useRealTimers())
describe("bounded latest-frame delivery", () => {
  it("delivers the latest dirty revision immediately after a slow IPC push", async () => {
    const blocked = deferred()
    const send = vi
      .fn()
      .mockReturnValueOnce(blocked.promise)
      .mockResolvedValue(undefined)
    const delivery = new LatestFrameDelivery(send)
    delivery.activate("run-1")
    delivery.request(1, () => frame(1))
    await settle()
    const captures = Array.from({ length: 99 }, (_, index) =>
      vi.fn(() => frame(index + 2))
    )
    captures.forEach((capture, index) => delivery.request(index + 2, capture))
    expect(send).toHaveBeenCalledTimes(1)
    expect(captures.every((capture) => capture.mock.calls.length === 0)).toBe(
      true
    )
    blocked.resolve()
    await settle()
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1][0]).toMatchObject({
      lease: "run-1",
      revision: 100,
      pixels: new Uint8Array([100, 0, 0, 255]),
    })
    expect(
      captures.slice(0, -1).every((capture) => capture.mock.calls.length === 0)
    ).toBe(true)
  })
  it("does not let an old revision replace the terminal clear", async () => {
    const blocked = deferred()
    const send = vi
      .fn()
      .mockReturnValueOnce(blocked.promise)
      .mockResolvedValue(undefined)
    const delivery = new LatestFrameDelivery(send)
    delivery.activate("run")
    delivery.request(1, () => frame(1))
    delivery.request(3, () => frame(0))
    delivery.request(2, () => frame(2))
    blocked.resolve()
    await settle()
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 3,
      pixels: new Uint8Array([0, 0, 0, 255]),
    })
  })
  it("discards pending work and retries after stop", async () => {
    vi.useFakeTimers()
    const blocked = deferred()
    const send = vi.fn(() => blocked.promise)
    const delivery = new LatestFrameDelivery(send)
    delivery.activate("old")
    delivery.request(1, () => frame(1))
    delivery.request(2, () => frame(2))
    delivery.stop()
    blocked.reject(new Error("stopped"))
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("starts a replacement lease at revision one without overlapping the obsolete push", async () => {
    const blocked = deferred()
    const send = vi
      .fn()
      .mockReturnValueOnce(blocked.promise)
      .mockResolvedValue(undefined)
    const delivery = new LatestFrameDelivery(send)
    delivery.activate("old")
    delivery.request(99, () => frame(9))
    delivery.activate("new")
    delivery.request(1, () => frame(1))
    expect(send).toHaveBeenCalledTimes(1)
    blocked.resolve()
    await settle()
    expect(send.mock.calls[1][0]).toMatchObject({ lease: "new", revision: 1 })
  })
  it("retries a failed final frame without a keepalive and lets newer content supersede it", async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined)
    const delivery = new LatestFrameDelivery(send, onError)
    delivery.activate("run")
    delivery.request(1, () => frame(1))
    await settle()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    delivery.request(2, () => frame(2))
    await settle()
    expect(send.mock.calls.at(-1)?.[0].revision).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it("retries unchanged content after a transient failure and stops its timer on disposal", async () => {
    vi.useFakeTimers()
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined)
    const delivery = new LatestFrameDelivery(send)
    delivery.activate("run")
    delivery.request(1, () => frame(1))
    await settle()
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(2)
    send.mockRejectedValue(new Error("offline"))
    delivery.request(2, () => frame(2))
    await settle()
    delivery.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
  it("isolates outputs so a blocked output cannot delay another", async () => {
    const blocked = deferred()
    const slow = new LatestFrameDelivery(() => blocked.promise)
    const sendFast = vi.fn().mockResolvedValue(undefined)
    const fast = new LatestFrameDelivery(sendFast)
    slow.activate("slow")
    fast.activate("fast")
    slow.request(1, () => frame(1))
    fast.request(1, () => frame(2))
    await settle()
    expect(sendFast).toHaveBeenCalledTimes(1)
    slow.stop()
    fast.stop()
    blocked.resolve()
    await settle()
  })
  it("rejects invalid and duplicate revisions without reading pixels", async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const capture = vi.fn(() => frame(1))
    const delivery = new LatestFrameDelivery(send)
    delivery.request(1, capture)
    delivery.activate("run")
    for (const revision of [0, -1, NaN, Infinity, 1.5])
      delivery.request(revision, capture)
    expect(capture).not.toHaveBeenCalled()
    delivery.request(1, capture)
    await settle()
    delivery.request(1, capture)
    await settle()
    expect(capture).toHaveBeenCalledTimes(1)
  })
})
