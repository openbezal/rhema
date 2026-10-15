export interface Submission {
  stage: string
  output?: string
  revision?: number
  acceptedMs?: number
}
export interface Receipt {
  receivedMs: number
  metadata: string
  pixel: number[]
  rateN: number
  rateD: number
}
/** Native-submit → local SDK capture only; renderer/IPC/vMix are excluded. */
export function analyzeNativeProbe(
  submitted: Submission[],
  received: Receipt[],
  output = "qa-0",
  clearAlpha = 0,
  expectedFps = 30
) {
  const first = new Map<number, Receipt>()
  let terminalSeen = false
  let staleAfterTerminal = false
  for (const row of received) {
    const match = /\brevision="(\d+)"/.exec(row.metadata)
    if (!match) continue
    const revision = Number(match[1])
    if (terminalSeen && revision < 111) staleAfterTerminal = true
    if (revision === 111) terminalSeen = true
    if (!first.has(revision)) first.set(revision, row)
  }
  const accepted = new Map<number, number>()
  for (const row of submitted) {
    if (row.stage !== "submitted" || row.output !== output) continue
    if (!Number.isSafeInteger(row.revision) || !Number.isFinite(row.acceptedMs))
      throw new Error("Invalid submission record")
    const revision = row.revision!,
      timestamp = row.acceptedMs!
    if (accepted.has(revision))
      throw new Error("Duplicate submission revision; use a single probe run")
    accepted.set(revision, timestamp)
  }
  const missing: number[] = []
  const measurements: {
    revision: number
    submittedMs: number
    receivedMs: number
    latencyMs: number
  }[] = []
  for (let revision = 11; revision <= 110; revision++) {
    const sent = accepted.get(revision),
      frame = first.get(revision)
    if (sent === undefined || !frame) {
      missing.push(revision)
      continue
    }
    const latency = frame.receivedMs - sent
    if (!Number.isFinite(latency) || latency < 0)
      throw new Error("Clock discontinuity invalidates this measurement")
    measurements.push({
      revision,
      submittedMs: sent,
      receivedMs: frame.receivedMs,
      latencyMs: latency,
    })
  }
  const sorted = measurements.map((row) => row.latencyMs).sort((a, b) => a - b)
  const percentile = (quantile: number) =>
    sorted.length ? sorted[Math.ceil(quantile * sorted.length) - 1] : null
  const clear = first.get(111)
  const terminalClear = Boolean(
    clear && clear.pixel.join(",") === `0,0,0,${clearAlpha}`
  )
  const exactRate =
    received.length > 0 &&
    received.every((row) => row.rateN === expectedFps && row.rateD === 1)
  return {
    scope:
      "native submit to local SDK capture; excludes renderer, IPC and vMix",
    valid:
      sorted.length === 100 &&
      missing.length === 0 &&
      terminalClear &&
      !staleAfterTerminal &&
      exactRate,
    output,
    samples: sorted.length,
    missing,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
    terminalClear,
    staleAfterTerminal,
    exactRate,
    measurements,
  }
}
