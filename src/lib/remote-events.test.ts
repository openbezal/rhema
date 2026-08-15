import { describe, expect, it } from "vitest"
import { REMOTE_EVENTS } from "./remote-events"

// The expected set is written out as literals on purpose. Deriving it from
// REMOTE_EVENTS would assert nothing — the point is to fail when a name here
// stops matching the one src-tauri/crates/api/src/dispatch.rs emits.
const EXPECTED_EVENT_NAMES = [
  "remote:next",
  "remote:prev",
  "remote:show",
  "remote:hide",
  "remote:theme",
  "remote:opacity",
  "remote:confidence",
  "remote:on_air",
  "remote:send_to_live",
  "remote:bible_next",
  "remote:bible_prev",
  "remote:add_to_queue",
]

describe("REMOTE_EVENTS", () => {
  it("has one entry per RemoteCommand variant", () => {
    expect(Object.keys(REMOTE_EVENTS)).toHaveLength(12)
  })

  it("matches the event names the Rust dispatcher emits", () => {
    expect(Object.values(REMOTE_EVENTS).sort()).toEqual(
      [...EXPECTED_EVENT_NAMES].sort(),
    )
  })

  it("names every key as its event minus the remote: prefix", () => {
    for (const [key, event] of Object.entries(REMOTE_EVENTS)) {
      expect(event).toBe(`remote:${key}`)
    }
  })
})
