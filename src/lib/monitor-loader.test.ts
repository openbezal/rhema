import { describe, expect, it } from "vitest"
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi"
import type { Monitor } from "@tauri-apps/api/window"
import { createMonitorLoader } from "./monitor-loader"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function monitor(name: string): Monitor {
  return {
    name,
    size: new PhysicalSize(1920, 1080),
    position: new PhysicalPosition(0, 0),
    workArea: {
      position: new PhysicalPosition(0, 0),
      size: new PhysicalSize(1920, 1080),
    },
    scaleFactor: 1,
  }
}

describe("monitor discovery", () => {
  it("marks automatic discovery pending until its result arrives", async () => {
    const request = deferred<Monitor[]>()
    let pending = false
    let found: Monitor[] = []
    const refresh = createMonitorLoader(
      () => request.promise,
      (value) => {
        found = value
      },
      (value) => {
        pending = value
      },
      () => {}
    )
    const finished = refresh()
    expect(pending).toBe(true)
    request.resolve([monitor("Projector")])
    await finished
    expect(pending).toBe(false)
    expect(found[0].name).toBe("Projector")
  })

  it("keeps the newest enumeration when older requests finish later", async () => {
    const older = deferred<Monitor[]>()
    const newer = deferred<Monitor[]>()
    const requests = [older, newer]
    let found: Monitor[] = []
    const refresh = createMonitorLoader(
      () => requests.shift()!.promise,
      (value) => {
        found = value
      },
      () => {},
      () => {}
    )
    const oldFinished = refresh()
    const newFinished = refresh()
    newer.resolve([monitor("New monitor")])
    await newFinished
    older.resolve([monitor("Disconnected monitor")])
    await oldFinished
    expect(found[0].name).toBe("New monitor")
  })

  it("does not end the current loading state when an older request fails", async () => {
    const older = deferred<Monitor[]>()
    const newer = deferred<Monitor[]>()
    const requests = [older, newer]
    let pending = false
    const errors: unknown[] = []
    const refresh = createMonitorLoader(
      () => requests.shift()!.promise,
      () => {},
      (value) => {
        pending = value
      },
      (error) => errors.push(error)
    )
    const oldFinished = refresh()
    const newFinished = refresh()
    older.reject(new Error("stale failure"))
    await oldFinished
    expect(pending).toBe(true)
    expect(errors).toEqual([])
    newer.resolve([])
    await newFinished
    expect(pending).toBe(false)
  })

  it("clears the list and reports a current discovery failure", async () => {
    const error = new Error("monitor unavailable")
    let pending = false
    let found = [monitor("Old")]
    const errors: unknown[] = []
    const refresh = createMonitorLoader(
      () => Promise.reject(error),
      (value) => {
        found = value
      },
      (value) => {
        pending = value
      },
      (value) => errors.push(value)
    )
    await refresh()
    expect(pending).toBe(false)
    expect(found).toEqual([])
    expect(errors).toEqual([error])
  })
})
