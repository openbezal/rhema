import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset()
})
it("shares native bootstrap and admits only the acknowledged revision", async () => {
  let finish!: (value: number) => void
  native.invoke.mockImplementation(
    () =>
      new Promise<number>((resolve) => {
        finish = resolve
      })
  )
  const session = await import("./session-revision")
  const first = session.ensureSessionRevision()
  const second = session.ensureSessionRevision()
  expect(native.invoke).toHaveBeenCalledOnce()
  expect(
    session.readSessionPayload({ revision: 0, payload: "before bootstrap" })
  ).toBeNull()
  finish(4)
  await expect(first).resolves.toBe(4)
  await expect(second).resolves.toBe(4)
  expect(
    session.readSessionPayload({ revision: 4, payload: "current" })
  ).toEqual({ payload: "current" })
  expect(session.readSessionPayload({ revision: 3, payload: "old" })).toBeNull()
  expect(
    session.readSessionPayload({ revision: 5, payload: "unacknowledged" })
  ).toBeNull()
  expect(session.readSessionPayload({ text: "raw legacy" })).toBeNull()
  expect(session.readSessionPayload({ revision: 4 })).toBeNull()
  session.acceptSessionReset(4, 5)
  expect(
    session.readSessionPayload({ revision: 4, payload: "queued old" })
  ).toBeNull()
  expect(session.readSessionPayload({ revision: 5, payload: null })).toEqual({
    payload: null,
  })
  await expect(session.ensureSessionRevision()).resolves.toBe(5)
  expect(native.invoke).toHaveBeenCalledOnce()
  expect(() => session.acceptSessionReset(4, 5)).toThrow()
  expect(() => session.acceptSessionReset(5, 7)).toThrow()
})
it.each([null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "0"])(
  "fails closed on invalid bootstrap %s and permits explicit retry",
  async (value) => {
    native.invoke.mockResolvedValueOnce(value).mockResolvedValueOnce(2)
    const session = await import("./session-revision")
    await expect(session.ensureSessionRevision()).rejects.toThrow(
      "session revision"
    )
    expect(
      session.readSessionPayload({ revision: 0, payload: "unsafe" })
    ).toBeNull()
    await expect(session.ensureSessionRevision()).resolves.toBe(2)
  }
)
