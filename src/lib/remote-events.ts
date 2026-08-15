/**
 * Event names the Rust remote-control dispatcher emits, one per `RemoteCommand`
 * variant.
 *
 * These strings are the only part of the remote-control contract that no
 * compiler or type checker validates — `src-tauri/crates/api/src/dispatch.rs`
 * writes them and this file reads them. A mismatch compiles, passes both test
 * suites, and then fails silently on an operator's controller, which is how
 * issue #146 shipped. Both sides pin the literals in tests; keep them in step.
 *
 * Keys are the command names as they appear on the wire (serde `snake_case`),
 * so a key is always its value with the `remote:` prefix removed.
 */
export const REMOTE_EVENTS = {
  next: "remote:next",
  prev: "remote:prev",
  show: "remote:show",
  hide: "remote:hide",
  theme: "remote:theme",
  opacity: "remote:opacity",
  confidence: "remote:confidence",
  on_air: "remote:on_air",
  send_to_live: "remote:send_to_live",
  bible_next: "remote:bible_next",
  bible_prev: "remote:bible_prev",
  add_to_queue: "remote:add_to_queue",
} as const

export type RemoteEventName = (typeof REMOTE_EVENTS)[keyof typeof REMOTE_EVENTS]
