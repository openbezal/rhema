import { invoke } from "@tauri-apps/api/core"

let revision: number | null = null
let loading: Promise<number> | null = null
function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/** A new main webview must learn the current native generation before it can
 * accept queued provider events. A failed read never enables a raw fallback. */
export function ensureSessionRevision(): Promise<number> {
  if (revision !== null) return Promise.resolve(revision)
  if (loading) return loading
  const job = invoke<unknown>("read_operator_session_revision").then(
    (value) => {
      if (!validRevision(value))
        throw new Error("Invalid native session revision. Restart Rhema.")
      revision = value
      return value
    }
  )
  loading = job
  void job.then(
    () => {
      if (loading === job) loading = null
    },
    () => {
      if (loading === job) loading = null
    }
  )
  return job
}

/** Only the exact acknowledged successor can publish a reset locally. */
export function acceptSessionReset(expected: number, next: number): void {
  if (revision !== expected || !validRevision(next) || next !== expected + 1)
    throw new Error(
      "Uncertain session reset. Export the current session and reload Rhema."
    )
  revision = next
}

export function readSessionPayload<T = unknown>(
  packet: unknown
): { payload: T } | null {
  if (revision === null || packet === null || typeof packet !== "object")
    return null
  const candidate = packet as Record<string, unknown>
  if (
    !validRevision(candidate.revision) ||
    candidate.revision !== revision ||
    !Object.hasOwn(candidate, "payload")
  )
    return null
  return { payload: candidate.payload as T }
}
