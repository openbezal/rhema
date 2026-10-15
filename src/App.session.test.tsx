// @vitest-environment jsdom
import { StrictMode, act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse, DetectionResult } from "@/types"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      const handlers = mocks.listeners.get(event) ?? new Set()
      handlers.add(handler)
      mocks.listeners.set(event, handlers)
      return () => handlers.delete(handler)
    }
  ),
}))
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))
vi.mock("@/components/tutorial/tutorial-overlay", () => ({
  TutorialOverlay: () => null,
}))
vi.mock("@/components/translation-selection-dialog", () => ({
  TranslationSelectionDialog: () => null,
}))
vi.mock("@/components/ui/canvas-verse", () => ({
  CanvasVerse: ({ verse }: { verse: { reference: string } | null }) => (
    <div>{verse?.reference ?? "No verse"}</div>
  ),
}))
vi.mock("@/components/layout/dashboard", async () => {
  const { TranscriptPanel } =
    await import("@/components/panels/transcript-panel")
  const { SearchPanel } = await import("@/components/panels/search-panel")
  return {
    Dashboard: () => {
      const [shown, setShown] = useState(true)
      return (
        <>
          <button onClick={() => setShown(!shown)}>Toggle panels</button>
          {shown && (
            <>
              <TranscriptPanel />
              <SearchPanel />
            </>
          )}
        </>
      )
    },
  }
})
import App from "./App"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useQueueStore } from "@/stores/queue-store"
const genesis: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 1,
  text: "Genesis one",
}
const john: Verse = {
  ...genesis,
  id: 43,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified John",
}
const detected: DetectionResult = {
  book_number: 43,
  book_name: "John",
  chapter: 3,
  verse: 16,
  verse_ref: "John 3:16",
  verse_text: "Candidate",
  confidence: 0.95,
  source: "direct",
  auto_queued: false,
  transcript_snippet: "John three sixteen",
  is_chapter_only: false,
}
let root: Root
let host: HTMLDivElement
const send = (event: string, payload: unknown) => {
  for (const handler of mocks.listeners.get(event) ?? []) handler({ payload })
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  Element.prototype.scrollIntoView = vi.fn()
  mocks.listeners.clear()
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "get_verse"
      ? args.bookNumber === 43
        ? john
        : { ...genesis, verse: args.verse }
      : command === "get_chapter"
        ? [john]
        : null
  )
  useBibleStore.setState({
    ...useBibleStore.getInitialState(),
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "King James Version",
        language: "en",
        is_downloaded: true,
        is_copyrighted: false,
      },
    ],
    books: [
      {
        id: 1,
        translation_id: 1,
        book_number: 1,
        name: "Genesis",
        abbreviation: "Gen",
        testament: "OT",
      },
      {
        id: 43,
        translation_id: 1,
        book_number: 43,
        name: "John",
        abbreviation: "Jn",
        testament: "NT",
      },
    ],
    selectedVerse: genesis,
    currentChapter: [
      genesis,
      { ...genesis, id: 2, verse: 2, text: "Genesis two" },
    ],
  })
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    autoLive: true,
  })
  useTranscriptStore.setState(useTranscriptStore.getInitialState())
  useDetectionStore.setState(useDetectionStore.getInitialState())
  useQueueStore.getState().clearQueue()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  Reflect.deleteProperty(Element.prototype, "scrollIntoView")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function mount() {
  await act(async () =>
    root.render(
      <StrictMode>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </StrictMode>
    )
  )
}
async function hide() {
  await act(async () => host.querySelector("button")?.click())
  expect(host.querySelector('[data-slot="transcript-panel"]')).toBeNull()
  expect(host.querySelector('[data-slot="search-panel"]')).toBeNull()
}
describe("app-root session integration", () => {
  it("ingests exactly once after actual Transcript and Search panels unmount under StrictMode", async () => {
    await mount()
    expect(host.querySelector('[data-slot="transcript-panel"]')).not.toBeNull()
    expect(mocks.listeners.get("transcript_final")?.size).toBe(1)
    await hide()
    await act(async () => {
      send("transcript_final", { text: "Panels are hidden", confidence: 1 })
      send("verse_detections", [detected])
      send("reading_mode_verse", { ...detected, reference: detected.verse_ref })
    })
    expect(useTranscriptStore.getState().segments).toHaveLength(1)
    expect(useDetectionStore.getState().detections).toHaveLength(1)
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(john)
    expect(useBibleStore.getState().selectedVerse).toEqual(genesis)
    expect(useBibleStore.getState().revealRequest).toBe(0)
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
    expect(mocks.listeners.get("verse_detections")?.size).toBe(1)
  })
  it("completes remote Bible actions and output-ready sync with both panels hidden", async () => {
    await mount()
    await hide()
    const sync = vi.spyOn(
      useBroadcastStore.getState(),
      "syncBroadcastOutputFor"
    )
    await act(async () => {
      send("remote:bible_next", {})
    })
    expect(useBroadcastStore.getState().liveSourceVerse?.verse).toBe(2)
    sync.mockClear()
    await act(async () =>
      send("broadcast:output-ready", {
        outputId: useBroadcastStore.getState().outputs[0].id,
      })
    )
    expect(sync).toHaveBeenCalledOnce()
    sync.mockRestore()
  })
  it("exposes Follow separately from Auto", async () => {
    await mount()
    const follow = host.querySelector<HTMLButtonElement>(
      '[aria-label="Follow detections"]'
    )
    expect(follow?.getAttribute("aria-checked")).toBe("false")
    await act(async () => follow?.click())
    expect(useBibleStore.getState().followDetections).toBe(true)
    await act(async () => {
      send("verse_detections", [detected])
    })
    expect(useBibleStore.getState().selectedVerse).toEqual(john)
  })
  it("presents a browsed verse with one click while Follow and Auto are off", async () => {
    useBroadcastStore.getState().setAutoLive(false)
    await mount()
    await act(async () => host.querySelector<HTMLElement>("#verse-2")?.click())
    expect(useBroadcastStore.getState().liveSourceVerse?.verse).toBe(2)
    expect(useQueueStore.getState().items).toHaveLength(0)
  })
  it("preserves the focused reference input during asynchronous navigation", async () => {
    await mount()
    const input = host.querySelector<HTMLInputElement>(
      '[data-tour="quick-nav"]'
    )!
    input.focus()
    await act(async () =>
      useBibleStore
        .getState()
        .setPendingNavigation({ bookNumber: 43, chapter: 3, verse: 16 })
    )
    expect(document.activeElement).toBe(input)
  })
  it.each(["pending", "rejected"])(
    "does not loop preview refresh against old rows with a %s chapter",
    async (chapterState) => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      await mount()
      useBibleStore
        .getState()
        .setTranslations([
          ...useBibleStore.getState().translations,
          {
            id: 2,
            abbreviation: "ESV",
            title: "ESV",
            language: "en",
            is_downloaded: true,
            is_copyrighted: true,
          },
        ])
      let reads = 0
      mocks.invoke.mockImplementation((command, args) => {
        if (command === "get_verse") {
          reads++
          return reads < 8
            ? Promise.resolve({ ...genesis, id: 100, translation_id: 2 })
            : new Promise(() => {})
        }
        if (command === "list_books")
          return Promise.resolve(
            useBibleStore
              .getState()
              .books.map((book) => ({
                ...book,
                translation_id: args.translationId,
              }))
          )
        if (command === "get_chapter")
          return chapterState === "rejected"
            ? Promise.reject(new Error("Chapter unavailable"))
            : new Promise(() => {})
        return Promise.resolve(null)
      })
      await act(async () => useBibleStore.getState().setActiveTranslation(2))
      expect(reads).toBeLessThanOrEqual(1)
      expect(useBibleStore.getState().selectedVerse?.translation_id).toBe(2)
    }
  )
  it.each(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"])(
    "keeps %s in the focused editor instead of invoking Bible navigation",
    async (key) => {
      useBroadcastStore.getState().setAutoLive(false)
      const second = { ...genesis, id: 2, verse: 2, text: "Genesis two" }
      useBibleStore.getState().selectVerse(key === "ArrowUp" ? second : genesis)
      await mount()
      const input = host.querySelector<HTMLInputElement>(
        '[data-tour="quick-nav"]'
      )!
      input.focus()
      const previous = useBibleStore.getState().selectedVerse
      mocks.invoke.mockClear()
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true })
        )
      )
      expect(useBibleStore.getState().selectedVerse).toEqual(previous)
      expect(useBroadcastStore.getState().liveVerse).toBeNull()
      expect(mocks.invoke).not.toHaveBeenCalledWith(
        "get_chapter",
        expect.anything()
      )
    }
  )

  it.each(["composition", "already handled"])(
    "ignores panel navigation when a key event is %s",
    async (reason) => {
      useBroadcastStore.getState().setAutoLive(false)
      await mount()
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
        isComposing: reason === "composition",
      })
      if (reason === "already handled") event.preventDefault()
      await act(async () =>
        host.querySelector('[data-slot="search-panel"]')?.dispatchEvent(event)
      )
      expect(useBroadcastStore.getState().liveVerse).toBeNull()
      expect(useBibleStore.getState().selectedVerse).toEqual(genesis)
    }
  )
  it("does not present or clear a reference while Enter accepts IME composition", async () => {
    useBroadcastStore.getState().setAutoLive(false)
    await mount()
    const input = host.querySelector<HTMLInputElement>(
      '[data-tour="quick-nav"]'
    )!
    input.focus()
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "John 3:16")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(useBibleStore.getState().selectedVerse).toEqual(john)
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        })
      )
    )
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(input.value).toBe("John 3:16")
  })
})
