// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest"
import { revealVerseInList } from "./verse-reveal"
afterEach(() => document.body.replaceChildren())
it.each([
  ["center", 75],
  ["nearest", 50],
  ["start", 100],
  ["end", 50],
] as const)(
  "reveals a verse with %s alignment inside its own list",
  (block, top) => {
    document.body.innerHTML =
      '<main><section data-operator-list="bible"><div id="verse">Text</div></section></main>'
    const list = document.querySelector<HTMLElement>("section")!,
      row = document.querySelector<HTMLElement>("#verse")!
    Object.defineProperties(list, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 500 },
      clientTop: { value: 0 },
    })
    list.getBoundingClientRect = () =>
      ({ top: 100, bottom: 200, height: 100 }) as DOMRect
    row.getBoundingClientRect = () =>
      ({ top: 200, bottom: 250, height: 50 }) as DOMRect
    list.scrollTo = vi.fn()
    row.scrollIntoView = vi.fn()
    revealVerseInList(row, block)
    expect(list.scrollTo).toHaveBeenCalledWith({ top, behavior: "smooth" })
    expect(row.scrollIntoView).not.toHaveBeenCalled()
  }
)
it("does not move an already visible verse or any outer workspace", () => {
  document.body.innerHTML =
    '<section data-operator-list="bible"><div>Text</div></section>'
  const list = document.querySelector<HTMLElement>("section")!,
    row = document.querySelector<HTMLElement>("section>div")!
  Object.defineProperties(list, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 500 },
    clientTop: { value: 0 },
  })
  list.getBoundingClientRect = () =>
    ({ top: 100, bottom: 200, height: 100 }) as DOMRect
  row.getBoundingClientRect = () =>
    ({ top: 120, bottom: 170, height: 50 }) as DOMRect
  list.scrollTo = vi.fn()
  revealVerseInList(row, "nearest")
  expect(list.scrollTo).not.toHaveBeenCalled()
})
