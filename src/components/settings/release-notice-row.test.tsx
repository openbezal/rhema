// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
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
const available = {
  status: "available",
  current_version: "0.3.2",
  latest_version: "0.3.3",
  url: "https://github.com/openbezal/rhema/releases/tag/v0.3.3",
}
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  native.invoke.mockReset()
  native.open.mockReset().mockResolvedValue(undefined)
  native.message.mockReset()
  native.error.mockReset()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it("renders checking, available Download, explicit retry and current status from the shared controller", async () => {
  let finish!: (value: unknown) => void
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { ReleaseNoticeRow } = await import("./release-notice-row")
  await act(async () => root.render(createElement(ReleaseNoticeRow)))
  expect(host.textContent).toContain("Checking for updates")
  expect(host.querySelector("button")?.disabled).toBe(true)
  await act(async () => finish(available))
  expect(host.textContent).toContain("Rhema 0.3.3 is available")
  const download = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Download"
  )!
  await act(async () => download.click())
  expect(native.open).toHaveBeenCalledExactlyOnceWith(available.url)
  const retry = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Check again"
  )!
  await act(async () => {
    retry.click()
    retry.click()
  })
  expect(native.invoke).toHaveBeenCalledTimes(2)
  await act(async () => finish({ status: "current", current_version: "0.3.2" }))
  expect(host.textContent).toContain("Up to date")
  expect(host.textContent).not.toContain("Download")
})
it("shows unavailable after offline failure and does not recheck on a Settings remount", async () => {
  native.invoke.mockRejectedValue(new Error("Synthetic offline"))
  const { ReleaseNoticeRow } = await import("./release-notice-row")
  await act(async () => root.render(createElement(ReleaseNoticeRow)))
  expect(host.textContent).toContain("Update check unavailable")
  expect(host.querySelector("button")?.disabled).toBe(false)
  await act(async () => root.render(null))
  await act(async () => root.render(createElement(ReleaseNoticeRow)))
  expect(native.invoke).toHaveBeenCalledTimes(1)
})
it("shares App and Diagnostics effects through StrictMode and a later remount without repeating the toast", async () => {
  native.invoke.mockImplementation(async (command) =>
    command === "claim_release_notice" ? true : available
  )
  const { ReleaseNoticeRow } = await import("./release-notice-row"),
    { useReleaseNotice } = await import("@/hooks/use-release-notice")
  function AppNotice() {
    useReleaseNotice()
    return <ReleaseNoticeRow />
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <AppNotice />
      </StrictMode>
    )
  )
  expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
    "check_release_notice",
    "claim_release_notice",
  ])
  expect(native.message).toHaveBeenCalledTimes(1)
  await act(async () => root.render(null))
  await act(async () =>
    root.render(
      <StrictMode>
        <AppNotice />
      </StrictMode>
    )
  )
  expect(native.invoke).toHaveBeenCalledTimes(2)
  expect(native.message).toHaveBeenCalledTimes(1)
})
