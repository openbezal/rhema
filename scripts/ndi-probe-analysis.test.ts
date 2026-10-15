import { expect, it } from "vitest"
import {
  analyzeNativeProbe,
  type Submission,
  type Receipt,
} from "./ndi-probe-analysis"
function pattern(revision: number) {
  return Array.from({ length: 8 }, (_, bit) =>
    revision === 111
      ? "00000000"
      : revision & (1 << bit)
        ? "ffffff80"
        : "00000080"
  ).join("")
}
function samples() {
  const submitted: Submission[] = Array.from({ length: 100 }, (_, i) => ({
    stage: "submitted",
    output: "qa-0",
    revision: i + 11,
    acceptedMs: 1_000,
    generation: "7",
    renderer: "1",
    width: 1280,
    height: 720,
  }))
  const received: Receipt[] = submitted.map((row, i) => ({
    receivedMs: 1_000 + i,
    metadata: `<rhema-frame generation="7" renderer="1" revision="${row.revision}"/>`,
    pixel: [10, 20, 30, 128],
    samples: pattern(row.revision!),
    width: 1280,
    height: 720,
    rateN: 30,
    rateD: 1,
  }))
  submitted.push({
    stage: "submitted",
    output: "qa-0",
    revision: 111,
    acceptedMs: 1_900,
    generation: "7",
    renderer: "1",
    width: 1280,
    height: 720,
  })
  received.push({
    receivedMs: 2_000,
    metadata: '<rhema-frame generation="7" renderer="1" revision="111"/>',
    pixel: [0, 0, 0, 0],
    samples: pattern(111),
    width: 1280,
    height: 720,
    rateN: 30,
    rateD: 1,
  })
  return { submitted, received }
}
it("uses nearest-rank percentiles and first receipt per revision", () => {
  const { submitted, received } = samples()
  received.splice(-1, 0, { ...received[0], receivedMs: 2_000 })
  expect(analyzeNativeProbe(submitted, received)).toMatchObject({
    valid: true,
    samples: 100,
    missing: [],
    p50Ms: 49,
    p95Ms: 94,
    p99Ms: 98,
    maxMs: 99,
    terminalClear: true,
  })
})
it("rejects a truncated observation window instead of reporting a complete benchmark", () => {
  const { submitted, received } = samples()
  const result = analyzeNativeProbe(submitted, received.slice(0, 99))
  expect(result).toMatchObject({
    valid: false,
    samples: 99,
    missing: [110],
    terminalClear: false,
  })
})
it("rejects clock discontinuities and checks opaque clear alpha", () => {
  const { submitted, received } = samples()
  expect(
    analyzeNativeProbe(submitted, received, "qa-0", 255).terminalClear
  ).toBe(false)
  received[0] = { ...received[0], receivedMs: 900 }
  expect(() => analyzeNativeProbe(submitted, received)).toThrow(/clock/i)
})

it("rejects any older revision after the terminal clear", () => {
  const { submitted, received } = samples()
  received.push({ ...received[0], receivedMs: 3_000 })
  expect(analyzeNativeProbe(submitted, received)).toMatchObject({
    valid: false,
    staleAfterTerminal: true,
  })
})

it("rejects frozen pixels even when metadata advances through all revisions", () => {
  const { submitted, received } = samples()
  received.forEach((row) => {
    row.pixel = [0, 0, 0, 0]
    row.samples = "00000000".repeat(8)
  })
  expect(analyzeNativeProbe(submitted, received).valid).toBe(false)
})

it("rejects wrong output dimensions or stale session identity", () => {
  const { submitted, received } = samples()
  received[0].width = 1920
  received[1].metadata = received[1].metadata.replace(
    'generation="7"',
    'generation="6"'
  )
  expect(analyzeNativeProbe(submitted, received)).toMatchObject({
    valid: false,
    mismatchedFrames: 2,
    missing: [11, 12],
  })
})
