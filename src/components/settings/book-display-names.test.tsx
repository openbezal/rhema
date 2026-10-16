// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ invoke: vi.fn(), flush: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }))
vi.mock("@/stores/settings-store", async (original) => ({
  ...(await original<typeof import("@/stores/settings-store")>()),
  flushSettingsPersistence: mock.flush,
}))
import { BookDisplayNamesEditor } from "./book-display-names"
import { useSettingsStore } from "@/stores/settings-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import { beginOperatorMaintenance } from "@/lib/operator-maintenance"
const translations = [1, 2].map((id) => ({
  id,
  abbreviation: id === 1 ? "KJV" : "BIUO",
  title: "Fixture",
  language: "en",
  is_downloaded: true,
  is_copyrighted: false,
}))
const book = (id = 1) => ({
  id: 66,
  translation_id: id,
  book_number: 66,
  name: "Revelation of John",
  abbreviation: "Rev",
  testament: "NT",
})
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mock.invoke.mockReset().mockImplementation(async () => [book()])
  mock.flush.mockReset().mockResolvedValue(undefined)
  useSettingsStore.setState({
    bookDisplayOverrides: [
      { translationCode: "FUTURE", bookNumber: 62, label: "1 Ọ̀rọ̀" },
    ],
  })
  useProfileStatusStore.setState({ readFailed: false })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <BookDisplayNamesEditor translations={translations} primaryCode="KJV" />
    )
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function rename(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Revelation of John display name"]'
  )!
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === name
  )!
  expect(button).not.toBeNull()
  await act(async () => button.click())
}
it("saves Revelation with its stable code, preserving other editions", async () => {
  await rename("Revelation")
  await click("Save names")
  expect(mock.flush).toHaveBeenCalledTimes(1)
  expect(useSettingsStore.getState().bookDisplayOverrides).toEqual([
    { translationCode: "FUTURE", bookNumber: 62, label: "1 Ọ̀rọ̀" },
    { translationCode: "KJV", bookNumber: 66, label: "Revelation" },
  ])
  expect(container.textContent).toContain("Names saved")
})
it("requires a save after resetting the current edition and keeps other edition names", async () => {
  await rename("Revelation")
  await click("Save names")
  await click("Reset edition names")
  expect(useSettingsStore.getState().bookDisplayOverrides).toHaveLength(2)
  await click("Save names")
  expect(useSettingsStore.getState().bookDisplayOverrides).toEqual([
    { translationCode: "FUTURE", bookNumber: 62, label: "1 Ọ̀rọ̀" },
  ])
})
it("keeps failed changes explicit and lets Save names retry", async () => {
  mock.flush.mockRejectedValueOnce(new Error("Synthetic disk full"))
  await rename("Revelation")
  await click("Save names")
  expect(container.textContent).toContain("not saved")
  expect(container.textContent).not.toContain("Names saved")
  await click("Save names")
  expect(mock.flush).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain("Names saved")
})
it("refuses invalid control characters before publishing or writing names", async () => {
  await rename("Bad\u0085Name")
  await click("Save names")
  expect(mock.flush).not.toHaveBeenCalled()
  expect(useSettingsStore.getState().bookDisplayOverrides).toHaveLength(1)
})
it("ignores an old edition's late book-list result", async () => {
  let finish!: (books: ReturnType<typeof book>[]) => void
  mock.invoke.mockImplementation(async (_command, args) =>
    args.translationId === 2
      ? new Promise((resolve) => {
          finish = resolve
        })
      : [book()]
  )
  const select = container.querySelector("select")!
  await act(async () => {
    select.value = "BIUO"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await act(async () => {
    select.value = "KJV"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await act(async () => finish([{ ...book(2), name: "Late obsolete edition" }]))
  expect(
    container.querySelector(
      'input[aria-label="Revelation of John display name"]'
    )
  ).not.toBeNull()
  expect(container.textContent).not.toContain("Late obsolete edition")
})
it("blocks saving unreadable profiles and active maintenance", async () => {
  await rename("Revelation")
  await act(async () => useProfileStatusStore.setState({ readFailed: true }))
  await click("Save names")
  expect(mock.flush).not.toHaveBeenCalled()
  await act(async () => useProfileStatusStore.setState({ readFailed: false }))
  let lease!: ReturnType<typeof beginOperatorMaintenance>
  await act(async () => {
    lease = beginOperatorMaintenance()
  })
  try {
    await click("Save names")
    expect(mock.flush).not.toHaveBeenCalled()
  } finally {
    await act(async () => lease.release())
  }
})
