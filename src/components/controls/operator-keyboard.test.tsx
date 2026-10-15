// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/components/ui/canvas-verse", () => ({ CanvasVerse: () => null }))
import { OperatorShortcutOverlays } from "./operator-shortcut-overlays"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { QueuePanel } from "@/components/panels/queue-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useOperatorUiStore } from "@/lib/operator-ui"
import { shortcutDefinitions } from "@/lib/shortcut-registry"
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
const verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified Scripture",
}
function Harness() {
  useKeyboardShortcuts()
  return (
    <>
      <QueuePanel />
      <SearchPanel />
      <OperatorShortcutOverlays />
    </>
  )
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
  Element.prototype.scrollIntoView = vi.fn()
  mocks.invoke.mockReset().mockImplementation(async (command) =>
    command === "get_chapter"
      ? [verse]
      : command === "list_books"
        ? [
            {
              id: 43,
              translation_id: 1,
              book_number: 43,
              name: "John",
              abbreviation: "Jn",
              testament: "NT",
            },
          ]
        : command === "get_verse"
          ? verse
          : []
  )
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "KJV",
        language: "en",
        is_downloaded: true,
        is_copyrighted: false,
      },
    ],
    books: [
      {
        id: 43,
        translation_id: 1,
        book_number: 43,
        name: "John",
        abbreviation: "Jn",
        testament: "NT",
      },
    ],
    currentChapter: [verse],
    selectedVerse: verse,
    pendingNavigation: null,
  })
  useQueueStore.setState({
    items: [
      {
        id: "q1",
        verse,
        reference: "John 3:16",
        confidence: 1,
        source: "manual",
        added_at: 0,
      },
    ],
    activeIndex: null,
  })
  useBroadcastStore.setState({
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
  })
  useOperatorUiStore.setState({
    commandsOpen: false,
    shortcutsOpen: false,
    searchFocusRevision: 0,
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function key(
  value: string,
  target: Element = document.body,
  options: KeyboardEventInit = {}
) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
        ...options,
      })
    )
  })
}
it("opens help from the registry and leaves Escape to the modal", async () => {
  await key("?")
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  for (const item of shortcutDefinitions)
    expect(dialog.textContent).toContain(item.label)
  mocks.invoke.mockClear()
  await key("s", dialog)
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "start_transcription",
    expect.anything()
  )
  await key("Escape", dialog)
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  )
  expect(mocks.invoke).not.toHaveBeenCalledWith("stop_reading_mode")
})
it("focuses a Queue card and presents through Enter without taking output live", async () => {
  await key("g")
  await key("q")
  expect(document.activeElement).toBe(
    host.querySelector('[data-slot="queue-panel"]')
  )
  await key("j", document.activeElement!)
  const card = host.querySelector('[data-operator-item="q1"]')!
  expect(document.activeElement).toBe(card)
  await key("Enter", card)
  await vi.waitFor(() =>
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse)
  )
  expect(useBroadcastStore.getState().isLive).toBe(false)
})
it("removes a focused Queue row without changing the live verse", async () => {
  const card = host.querySelector<HTMLElement>('[data-operator-item="q1"]')!
  card.focus()
  await key("Delete", card)
  expect(useQueueStore.getState().items).toHaveLength(0)
  expect(useBroadcastStore.getState().liveVerse).toBeNull()
})
it("slash returns from context search and focuses the actual quick input", async () => {
  const context = host.querySelector<HTMLButtonElement>(
    '[data-tour="context-search"]'
  )!
  await act(async () => context.click())
  expect(host.querySelector('[data-tour="quick-nav"]')).toBeNull()
  await key("/")
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      host.querySelector('[data-tour="quick-nav"]')
    )
  )
})
it("opens the searchable palette and keeps typed single-letter verbs inside it", async () => {
  await key("k", document.body, { ctrlKey: true })
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!
  expect(input).not.toBeNull()
  mocks.invoke.mockClear()
  await key("s", input)
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "start_transcription",
    expect.anything()
  )
  expect(document.querySelector("[cmdk-list]")!.textContent).toContain(
    "Switch translation to KJV"
  )
})
it("runs a palette focus command after its modal has released focus", async () => {
  await key("k", document.body, { ctrlKey: true })
  const command = [
    ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
  ].find((item) => item.textContent?.startsWith("Focus search input"))!
  await act(async () => command.click())
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      host.querySelector('[data-tour="quick-nav"]')
    )
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it("executes a selected palette translation command once after closing", async () => {
  await key("k", document.body, { metaKey: true })
  mocks.invoke.mockClear()
  const command = [
    ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
  ].find((item) => item.textContent === "Switch translation to KJV")!
  await act(async () => command.click())
  await vi.waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("set_active_translation", {
      translationId: 1,
    })
  )
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "set_active_translation"
    )
  ).toHaveLength(1)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it("browse palette selection validates Scripture and stages preview navigation only", async () => {
  await key("k", document.body, { ctrlKey: true })
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "John 3:16")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  const command = [
    ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
  ].find((item) => item.textContent === "Browse John 3:16 in Bible")!
  expect(command).toBeDefined()
  await act(async () => command.click())
  await vi.waitFor(() =>
    expect(useBibleStore.getState().pendingNavigation).toMatchObject({
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
  )
  expect(useBroadcastStore.getState().liveVerse).toBeNull()
  expect(useBroadcastStore.getState().isLive).toBe(false)
})
it("Escape clears quick search, then unfocuses it, then leaves reading mode", async () => {
  await key("/")
  const input = host.querySelector<HTMLInputElement>('[data-tour="quick-nav"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "words")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  mocks.invoke.mockClear()
  await key("Escape", input)
  expect(input.value).toBe("")
  expect(document.activeElement).toBe(input)
  await key("Escape", input)
  expect(document.activeElement).not.toBe(input)
  expect(mocks.invoke).not.toHaveBeenCalledWith("stop_reading_mode")
  await key("Escape")
  expect(mocks.invoke).toHaveBeenCalledWith("stop_reading_mode")
})
it("navigates and presents focused context-search results through the same list keys", async () => {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[data-tour="context-search"]')!
      .click()
  )
  await act(async () =>
    useBibleStore
      .getState()
      .setSemanticResults([
        {
          verse_ref: "John 3:16",
          verse_text: verse.text,
          book_name: "John",
          book_number: 43,
          chapter: 3,
          verse: 16,
          similarity: 1,
          sources: ["reference"],
        },
      ])
  )
  await key("g")
  await key("s")
  expect(document.activeElement?.getAttribute("data-operator-list")).toBe(
    "context"
  )
  await key("j", document.activeElement!)
  const card = document.activeElement!
  expect(card.getAttribute("data-operator-item")).not.toBeNull()
  await key("Enter", card)
  await vi.waitFor(() =>
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse)
  )
})
