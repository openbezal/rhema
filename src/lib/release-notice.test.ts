import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  message: vi.fn(),
  error: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: native.open }))
vi.mock("sonner", () => ({
  toast: Object.assign(native.message, { error: native.error }),
}))
const current = { status: "current", current_version: "0.3.2" }
const available = {
  status: "available",
  current_version: "0.3.2",
  latest_version: "0.3.3",
  url: "https://github.com/openbezal/rhema/releases/tag/v0.3.3",
}
beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset()
  native.open.mockReset().mockResolvedValue(undefined)
  native.message.mockReset()
  native.error.mockReset()
})
it("shares the initial check across App, Settings and remounts and coalesces explicit retry", async () => {
  let finish!: (value: unknown) => void
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const m = await import("./release-notice")
  const first = m.getReleaseNotice(),
    second = m.getReleaseNotice()
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith(
    "check_release_notice",
    { retry: false }
  )
  finish(current)
  expect(await first).toEqual(current)
  expect(await second).toEqual(current)
  await m.getReleaseNotice()
  expect(native.invoke).toHaveBeenCalledTimes(1)
  const retry = m.retryReleaseNotice(),
    joined = m.retryReleaseNotice(),
    initial = m.getReleaseNotice()
  expect(native.invoke).toHaveBeenCalledTimes(2)
  finish(available)
  expect(await retry).toEqual(available)
  expect(await joined).toEqual(available)
  expect(await initial).toEqual(available)
  expect(m.useReleaseNoticeStore.getState()).toMatchObject({
    checking: false,
    notice: available,
  })
})
it("keeps offline startup silent and offers retry without a second startup toast", async () => {
  native.invoke.mockRejectedValueOnce(new Error("Synthetic offline"))
  const m = await import("./release-notice")
  await m.showStartupReleaseNotice()
  expect(native.message).not.toHaveBeenCalled()
  expect(native.error).not.toHaveBeenCalled()
  expect(m.useReleaseNoticeStore.getState()).toMatchObject({
    checking: false,
    notice: null,
  })
  native.invoke.mockResolvedValueOnce(available)
  await m.retryReleaseNotice()
  await m.showStartupReleaseNotice()
  expect(native.message).not.toHaveBeenCalled()
  expect(native.invoke).toHaveBeenCalledTimes(2)
})
it("announces once and opens only the verified release URL after an explicit Download click", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "claim_release_notice" ? true : available
  )
  const m = await import("./release-notice")
  await Promise.all([
    m.showStartupReleaseNotice(),
    m.showStartupReleaseNotice(),
  ])
  await m.showStartupReleaseNotice()
  expect(native.message).toHaveBeenCalledTimes(1)
  expect(native.open).not.toHaveBeenCalled()
  const options = native.message.mock.calls[0][1]
  expect(options.action.label).toBe("Download")
  await options.action.onClick()
  expect(native.open).toHaveBeenCalledExactlyOnceWith(available.url)
  native.open.mockRejectedValueOnce(new Error("Synthetic opener failure"))
  await m.downloadRelease(available)
  expect(native.error).toHaveBeenCalledTimes(1)
})
it("does not repeat a notice already claimed earlier in the native launch", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "claim_release_notice" ? false : available
  )
  const m = await import("./release-notice")
  await m.showStartupReleaseNotice()
  expect(native.message).not.toHaveBeenCalled()
})
it.each([
  null,
  { ...available, url: "https://untrusted.invalid/release" },
  {
    ...available,
    url: "https://github.com/openbezal/rhema/releases/tag/v9.0.0",
  },
  { ...available, latest_version: "0.3.3-beta.1" },
  { status: "available" },
  { status: "future" },
])(
  "treats malformed native result as unavailable without prompting: %j",
  async (value) => {
    native.invoke.mockResolvedValue(value)
    const m = await import("./release-notice")
    expect(await m.getReleaseNotice()).toBeNull()
    await m.showStartupReleaseNotice()
    expect(native.message).not.toHaveBeenCalled()
    expect(native.error).not.toHaveBeenCalled()
  }
)
