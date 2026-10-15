// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  connectKeyboardShortcuts,
  shortcutDefinitions,
  shortcutHint,
} from "./shortcut-registry"
let dispose: (() => void) | undefined
const run = vi.fn()
function key(
  value: string,
  target: Element = document.body,
  extra: KeyboardEventInit = {}
) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...extra,
  })
  target.dispatchEvent(event)
  return event
}
beforeEach(() => {
  document.body.innerHTML = ""
  run.mockReset()
  vi.useFakeTimers()
  dispose = connectKeyboardShortcuts(run)
})
afterEach(() => {
  dispose?.()
  vi.useRealTimers()
})
it.each([
  [" ", "toggle-live"],
  ["s", "toggle-transcription"],
  ["/", "focus-search"],
  ["?", "show-shortcuts"],
  ["[", "previous-verse"],
  ["]", "next-verse"],
  ["{", "previous-chapter"],
  ["}", "next-chapter"],
])("dispatches %s through the registry", (value, id) => {
  expect(key(value).defaultPrevented).toBe(true)
  expect(run).toHaveBeenCalledWith(id, expect.any(KeyboardEvent))
})
it.each([
  ["t", "focus-transcript"],
  ["q", "focus-queue"],
  ["s", "focus-search-panel"],
  ["d", "focus-detections"],
  ["p", "focus-preview"],
  ["l", "focus-live"],
])("resolves the G %s chord", (value, id) => {
  key("g")
  key(value)
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith(id, expect.any(KeyboardEvent))
})
it("expires/cancels chords and ignores a chord start key held down", () => {
  key("g")
  vi.advanceTimersByTime(1100)
  key("t")
  expect(run).not.toHaveBeenCalled()
  key("g")
  key("x")
  key("q")
  expect(run).not.toHaveBeenCalled()
  key("g", document.body, { repeat: true })
  key("q")
  expect(run).not.toHaveBeenCalled()
})
it.each([
  "input",
  "textarea",
  "select",
  "div[role=textbox]",
  "span[contenteditable=true]",
  "div[contenteditable=true] > span",
  "div[role=combobox] > span",
])("does not dispatch while typing in %s", (selector) => {
  const root = document.createElement(
    selector.startsWith("input")
      ? "input"
      : selector.startsWith("textarea")
        ? "textarea"
        : selector.startsWith("select")
          ? "select"
          : "div"
  )
  if (selector.includes("role=textbox")) root.setAttribute("role", "textbox")
  if (selector.includes("combobox")) root.setAttribute("role", "combobox")
  if (selector.includes("contenteditable"))
    root.setAttribute("contenteditable", "true")
  const child = selector.includes(">") ? document.createElement("span") : root
  if (child !== root) root.append(child)
  document.body.append(root)
  for (const value of [" ", "s", "/", "?", "[", "]", "g", "q"])
    expect(key(value, child).defaultPrevented).toBe(false)
  key("k", child, { ctrlKey: true })
  expect(run).not.toHaveBeenCalled()
})
it("ignores IME, held actions, OS shortcuts and already consumed events", () => {
  key("s", document.body, { isComposing: true })
  key("s", document.body, { repeat: true })
  key("s", document.body, { metaKey: true })
  key("s", document.body, { altKey: true })
  const e = new KeyboardEvent("keydown", {
    key: " ",
    bubbles: true,
    cancelable: true,
  })
  e.preventDefault()
  document.body.dispatchEvent(e)
  expect(run).not.toHaveBeenCalled()
})
it("blocks shortcuts while a modal is open, even when focus escapes it", () => {
  document.body.innerHTML =
    '<div role="dialog" aria-modal="true"><button>Close</button></div>'
  key(" ")
  key("s")
  key("k", document.body, { metaKey: true })
  key("Escape")
  expect(run).not.toHaveBeenCalled()
})
it.each([{ metaKey: true }, { ctrlKey: true }])(
  "opens palette with a platform modifier",
  (modifier) => {
    key("k", document.body, modifier)
    expect(run).toHaveBeenCalledWith("show-commands", expect.any(KeyboardEvent))
  }
)
it("Escape clears a partial chord and delegates safe unfocus outside dialogs", () => {
  key("g")
  key("Escape")
  key("q")
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith("escape", expect.any(KeyboardEvent))
})
it("supports Escape to blur editors without invoking a live/transcription command", () => {
  const input = document.createElement("input")
  document.body.append(input)
  input.focus()
  key("Escape", input)
  expect(run).toHaveBeenCalledWith("escape", expect.any(KeyboardEvent))
  expect(run).toHaveBeenCalledTimes(1)
})
it.each([
  ["j", "list-next"],
  ["ArrowDown", "list-next"],
  ["k", "list-previous"],
  ["ArrowUp", "list-previous"],
  ["Enter", "list-present"],
  ["Delete", "list-remove"],
  ["Backspace", "list-remove"],
])("scopes %s to a focused operator list", (value, id) => {
  key(value)
  expect(run).not.toHaveBeenCalled()
  const list = document.createElement("div")
  list.dataset.operatorList = "queue"
  document.body.append(list)
  key(value, list)
  expect(run).toHaveBeenCalledWith(id, expect.any(KeyboardEvent))
})
it("removal is exclusive to Queue and modifier Enter is discoverable", () => {
  const list = document.createElement("div")
  list.dataset.operatorList = "detections"
  document.body.append(list)
  expect(key("Delete", list).defaultPrevented).toBe(false)
  list.dataset.operatorList = "queue"
  key("Enter", list, { metaKey: true })
  expect(run).toHaveBeenCalledWith(
    "list-present-clear",
    expect.any(KeyboardEvent)
  )
  expect(shortcutHint("toggle-transcription")).toBe("S")
  expect(
    shortcutDefinitions.every((item) => item.label && item.bindings.length)
  ).toBe(true)
  expect(
    shortcutDefinitions.some((item) =>
      (item.bindings as readonly string[]).includes("P")
    )
  ).toBe(false)
})
it("unsubscribes and clears pending chords", () => {
  key("g")
  dispose?.()
  key("q")
  key("s")
  expect(run).not.toHaveBeenCalled()
})
it("preserves native Space/Enter activation on focused buttons and switches", () => {
  document.body.innerHTML =
    '<section data-operator-list="queue"><article data-operator-item="a"><button>Dismiss</button><button role="switch">Live</button></article></section>'
  for (const button of document.querySelectorAll("button")) {
    key(" ", button)
    key("Enter", button)
  }
  expect(run).not.toHaveBeenCalled()
})
it("does not consume modified Escape or an active menu key", () => {
  key("Escape", document.body, { metaKey: true })
  document.body.innerHTML =
    '<div role="menu"><button role="menuitem">Item</button></div>'
  key("s", document.querySelector("button")!)
  expect(run).not.toHaveBeenCalled()
})
it("clears a partial chord on focus change and composition start", () => {
  const input = document.createElement("input")
  document.body.append(input)
  key("g")
  input.focus()
  key("q")
  expect(run).not.toHaveBeenCalled()
  key("g")
  document.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true })
  )
  key("q")
  expect(run).not.toHaveBeenCalled()
})
it("does not steal unconfigured shifted or dual-modifier shortcuts", () => {
  key(" ", document.body, { shiftKey: true })
  key("s", document.body, { shiftKey: true })
  key("k", document.body, { ctrlKey: true, metaKey: true })
  expect(run).not.toHaveBeenCalled()
})
it("scopes modifier Enter selection clearing to Queue", () => {
  const list = document.createElement("div")
  list.dataset.operatorList = "detections"
  document.body.append(list)
  expect(key("Enter", list, { metaKey: true }).defaultPrevented).toBe(false)
  expect(run).not.toHaveBeenCalled()
  list.dataset.operatorList = "queue"
  key("Enter", list, { ctrlKey: true })
  expect(run).toHaveBeenCalledWith(
    "list-present-clear",
    expect.any(KeyboardEvent)
  )
})
