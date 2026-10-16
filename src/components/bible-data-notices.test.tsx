// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it } from "vitest"
import { BibleDataNotices } from "./bible-data-notices"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let dispose: (() => void) | undefined
afterEach(() => {
  act(() => dispose?.())
  document.body.innerHTML = ""
})
it("exposes each complete packaged notice through a labeled language selector", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  dispose = () => root.unmount()
  await act(async () => root.render(<BibleDataNotices />))
  await act(async () => host.querySelector("button")!.click())
  const select = document.querySelector<HTMLSelectElement>(
    'select[aria-label="Notice language"]'
  )
  expect(select).not.toBeNull()
  for (const [value, copyright] of [
    ["BSRK", "Copyright © 2009, 2020"],
    ["BIUO", "Copyright © 1980, 1988, 2019, 2020"],
    ["OYCB", "Copyright © 2009, 2017"],
  ]) {
    document.querySelector("pre")!.scrollTop = 200
    await act(async () => {
      select!.value = value
      select!.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(document.querySelector("pre")!.scrollTop).toBe(0)
    expect(document.querySelector("pre")!.textContent).toContain(copyright)
    expect(document.querySelector("pre")!.textContent).toContain(
      "creativecommons.org/licenses/by-sa/4.0/"
    )
  }
})
