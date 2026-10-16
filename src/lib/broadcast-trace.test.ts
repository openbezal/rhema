import { afterEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ mark: vi.fn() }))
vi.mock("./latency-marks", () => ({ mark: mocks.mark }))
import { createBroadcastTrace, markBroadcastTrace } from "./broadcast-trace"
afterEach(() => {
  vi.useRealTimers()
  mocks.mark.mockClear()
})
it("uses a unique trace and common host epoch timestamps instead of mixed monotonic origins", () => {
  vi.useFakeTimers()
  vi.setSystemTime(123_000)
  const first = createBroadcastTrace()
  const next = createBroadcastTrace()
  expect(first.id).not.toBe(next.id)
  expect(first.acceptedEpochMs).toBe(123_000)
  markBroadcastTrace(first, "resolved")
  expect(mocks.mark).toHaveBeenCalledWith(
    expect.stringContaining(`broadcast trace=${first.id} stage=resolved`)
  )
  expect(mocks.mark.mock.calls[0][0]).toContain("accepted_ms=123000")
})
