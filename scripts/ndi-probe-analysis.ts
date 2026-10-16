export interface Submission {
  stage: string
  output?: string
  revision?: number
  acceptedMs?: number
  generation?: string
  renderer?: string
  width?: number
  height?: number
}
export interface Receipt {
  receivedMs: number
  metadata: string
  pixel: number[]
  /** Eight center RGBA samples, encoded as 64 lowercase hexadecimal digits. */
  samples: string
  width: number
  height: number
  rateN: number
  rateD: number
}
function matchesPattern(
  samples: string,
  revision: number,
  alpha: number
): boolean {
  if (!/^[0-9a-f]{64}$/.test(samples)) return false
  for (let bit = 0; bit < 8; bit++) {
    const rgba = Array.from({ length: 4 }, (_, channel) =>
      Number.parseInt(
        samples.slice(bit * 8 + channel * 2, bit * 8 + channel * 2 + 2),
        16
      )
    )
    const white = revision !== 111 && Boolean(revision & (1 << bit))
    if (rgba.slice(0, 3).some((value) => (white ? value < 192 : value > 64)))
      return false
    if (
      Math.abs(
        rgba[3] - (revision === 111 ? alpha : alpha === 255 ? 255 : 128)
      ) > 2
    )
      return false
  }
  return true
}
/** Native-submit → first correct patterned SDK capture; renderer/IPC/vMix excluded. */
export function analyzeNativeProbe(
  submitted: Submission[],
  received: Receipt[],
  output = "qa-0",
  clearAlpha = 0,
  expectedFps = 30
) {
  const accepted = new Map<number, Submission>()
  for (const row of submitted) {
    if (row.stage !== "submitted" || row.output !== output) continue
    if (
      !Number.isSafeInteger(row.revision) ||
      !Number.isFinite(row.acceptedMs) ||
      !row.generation ||
      !row.renderer ||
      !row.width ||
      !row.height
    )
      throw new Error(
        "Invalid submission record (identity and dimensions required)"
      )
    if (accepted.has(row.revision!))
      throw new Error("Duplicate submission revision; use a single probe run")
    accepted.set(row.revision!, row)
  }
  const first = new Map<number, Receipt>()
  let terminalSeen = false,
    staleAfterTerminal = false,
    mismatchedFrames = 0
  for (const row of received) {
    const revision = Number(/\brevision="(\d+)"/.exec(row.metadata)?.[1])
    if (!Number.isSafeInteger(revision)) continue
    if (terminalSeen && revision < 111) staleAfterTerminal = true
    const expected = accepted.get(revision)
    if (!expected || revision < 11 || revision > 111) continue
    const generation = /\bgeneration="([^"]+)"/.exec(row.metadata)?.[1]
    const renderer = /\brenderer="([^"]+)"/.exec(row.metadata)?.[1]
    if (
      generation !== expected.generation ||
      renderer !== expected.renderer ||
      row.width !== expected.width ||
      row.height !== expected.height ||
      !matchesPattern(row.samples, revision, clearAlpha)
    ) {
      mismatchedFrames++
      continue
    }
    if (revision === 111) terminalSeen = true
    if (!first.has(revision)) first.set(revision, row)
  }
  const missing: number[] = []
  const measurements: {
    revision: number
    submittedMs: number
    receivedMs: number
    latencyMs: number
    samples: string
    width: number
    height: number
    metadata: string
  }[] = []
  for (let revision = 11; revision <= 110; revision++) {
    const sent = accepted.get(revision)?.acceptedMs,
      frame = first.get(revision)
    if (sent === undefined || !frame) {
      missing.push(revision)
      continue
    }
    const latency = frame.receivedMs - sent
    if (!Number.isFinite(latency) || latency < 0)
      throw new Error(
        "Negative/nonfinite clock difference invalidates this measurement"
      )
    measurements.push({
      revision,
      submittedMs: sent,
      receivedMs: frame.receivedMs,
      latencyMs: latency,
      samples: frame.samples,
      width: frame.width,
      height: frame.height,
      metadata: frame.metadata,
    })
  }
  const sorted = measurements.map((row) => row.latencyMs).sort((a, b) => a - b)
  const percentile = (q: number) =>
    sorted.length ? sorted[Math.ceil(q * sorted.length) - 1] : null
  const terminalClear = first.has(111)
  const exactRate =
    received.length > 0 &&
    received.every((row) => row.rateN === expectedFps && row.rateD === 1)
  return {
    scope:
      "native submit to first correct patterned local SDK capture; excludes renderer, IPC and vMix",
    valid:
      sorted.length === 100 &&
      !missing.length &&
      terminalClear &&
      !staleAfterTerminal &&
      exactRate &&
      !mismatchedFrames,
    output,
    samples: sorted.length,
    missing,
    mismatchedFrames,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
    terminalClear,
    terminalSamples: first.get(111)?.samples ?? null,
    staleAfterTerminal,
    exactRate,
    measurements,
  }
}
