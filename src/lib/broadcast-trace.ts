import { mark } from "./latency-marks"
export interface BroadcastTrace {
  id: string
  acceptedEpochMs: number
}
export function createBroadcastTrace(): BroadcastTrace {
  return { id: crypto.randomUUID(), acceptedEpochMs: Date.now() }
}
/** Every webview/backend stage uses this host's epoch clock. Never subtract
 * performance.now() from Rust Instant or from another webview's origin.
 */
export function markBroadcastTrace(
  trace: BroadcastTrace,
  stage: string,
  outputId?: string
): void {
  mark(
    `broadcast trace=${trace.id} stage=${stage} accepted_ms=${trace.acceptedEpochMs}${outputId ? ` output=${outputId}` : ""}`
  )
}
