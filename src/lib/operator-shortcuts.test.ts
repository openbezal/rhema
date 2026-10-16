// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
import {
  runShortcutCommand,
  stepChapter,
  focusOperatorPanel,
} from "./operator-shortcuts"
import { operatorActions } from "./operator-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { invalidatePresentation } from "./presentation-controller"
import { useOperatorUiStore } from "./operator-ui"
import { beginOperatorMaintenance } from "./operator-maintenance"
import type { Verse } from "@/types"
const verse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 1,
  text: "Primary verse",
}
beforeEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  mocks.invoke.mockReset()
  invalidatePresentation()
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
    selectedVerse: verse,
    currentChapter: [verse],
    pendingNavigation: null,
  })
  useBroadcastStore.setState({
    isLive: false,
    autoLive: false,
    liveSourceVerse: null,
    liveVerse: null,
  })
  useQueueStore.setState({ items: [], activeIndex: null })
  useOperatorUiStore.setState({
    commandsOpen: false,
    shortcutsOpen: false,
    searchFocusRevision: 0,
  })
  mocks.invoke.mockImplementation((command, args) =>
    Promise.resolve(
      command === "get_verse"
        ? { ...verse, chapter: args.chapter, verse: args.verse }
        : command === "get_chapter"
          ? [{ ...verse, id: 2, chapter: args.chapter }]
          : null
    )
  )
})
function event(target: Element = document.body) {
  const e = new KeyboardEvent("keydown", { bubbles: true })
  target.dispatchEvent(e)
  return e
}
it("dispatches live through the same output-safety action used by remotes", async () => {
  const action = vi
    .spyOn(operatorActions, "toggleOnAir")
    .mockResolvedValue(undefined)
  await runShortcutCommand("toggle-live", event())
  expect(action).toHaveBeenCalledWith(true)
  useBroadcastStore.setState({ isLive: true })
  await runShortcutCommand("toggle-live", event())
  expect(action).toHaveBeenLastCalledWith(false)
})
it("presents a bracket step through the actual shared action/controller without going on air", async () => {
  const next = { ...verse, id: 2, verse: 2, text: "Next verse" }
  useBibleStore.setState({ currentChapter: [verse, next] })
  mocks.invoke.mockResolvedValue(next)
  await runShortcutCommand("next-verse", event())
  await vi.waitFor(() =>
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(next)
  )
  expect(useBibleStore.getState().selectedVerse).toEqual(next)
  expect(useBroadcastStore.getState().isLive).toBe(false)
})
it.each([
  ["next", 4],
  ["prev", 2],
] as const)(
  "probes a %s chapter and lands on its first real verse",
  async (direction, chapter) => {
    await stepChapter(direction)
    expect(useBibleStore.getState().pendingNavigation).toMatchObject({
      bookNumber: 43,
      chapter,
      verse: 1,
      present: true,
    })
  }
)
it("does not navigate into a missing chapter or before chapter1", async () => {
  mocks.invoke.mockResolvedValue([])
  await stepChapter("next")
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
  useBibleStore.setState({ selectedVerse: { ...verse, chapter: 1 } })
  await stepChapter("prev")
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
})
it("rejects a chapter response after a newer presentation intent or translation", async () => {
  let finish!: (rows: Verse[]) => void
  mocks.invoke.mockImplementation(
    () =>
      new Promise<Verse[]>((resolve) => {
        finish = resolve
      })
  )
  const task = stepChapter("next")
  invalidatePresentation()
  useBibleStore.setState({ activeTranslationId: 2 })
  finish([{ ...verse, chapter: 4 }])
  await task
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
})
it.each([
  "transcript",
  "queue",
  "search",
  "detections",
  "preview",
  "live-output",
] as const)("focuses the stable %s panel", (panel) => {
  const section = document.createElement("section")
  section.dataset.slot = `${panel}-panel`
  section.tabIndex = -1
  document.body.append(section)
  expect(focusOperatorPanel(panel)).toBe(true)
  expect(document.activeElement).toBe(section)
})
it("requests search focus and opens discoverability overlays", async () => {
  await runShortcutCommand("focus-search", event())
  expect(useOperatorUiStore.getState().searchFocusRevision).toBe(1)
  await runShortcutCommand("show-commands", event())
  expect(useOperatorUiStore.getState().commandsOpen).toBe(true)
  await runShortcutCommand("show-shortcuts", event())
  expect(useOperatorUiStore.getState().shortcutsOpen).toBe(true)
})
it("Escape blurs an editor first and leaves reading mode when outside it", async () => {
  const input = document.createElement("input")
  document.body.append(input)
  input.focus()
  await runShortcutCommand("escape", event(input))
  expect(document.activeElement).not.toBe(input)
  expect(mocks.invoke).not.toHaveBeenCalled()
  await runShortcutCommand("escape", event())
  expect(mocks.invoke).toHaveBeenCalledWith("stop_reading_mode")
})
it("moves actual card focus without presenting and activates only the marked action", async () => {
  document.body.innerHTML =
    '<section data-operator-list="queue" tabindex="-1"><article data-operator-item="a" tabindex="0"><button data-operator-present>Present</button><button data-operator-remove>Remove</button></article><article data-operator-item="b" tabindex="0"><button data-operator-present>Present</button></article></section>'
  const cards = [
      ...document.querySelectorAll<HTMLElement>("[data-operator-item]"),
    ],
    present = vi.fn(),
    remove = vi.fn()
  cards[0]
    .querySelector("[data-operator-present]")!
    .addEventListener("click", present)
  cards[0]
    .querySelector("[data-operator-remove]")!
    .addEventListener("click", remove)
  await runShortcutCommand(
    "list-next",
    event(document.querySelector("section")!)
  )
  expect(document.activeElement).toBe(cards[0])
  expect(present).not.toHaveBeenCalled()
  await runShortcutCommand("list-next", event(cards[0]))
  expect(document.activeElement).toBe(cards[1])
  await runShortcutCommand("list-previous", event(cards[1]))
  expect(document.activeElement).toBe(cards[0])
  await runShortcutCommand("list-present", event(cards[0]))
  expect(present).toHaveBeenCalledOnce()
  await runShortcutCommand("list-remove", event(cards[0]))
  expect(remove).toHaveBeenCalledOnce()
})
it("finds live Queue position by canonical coordinates when labels have translation suffixes", () => {
  const queueItem = (id: string, reference: string, v: Verse) => ({
    id,
    reference,
    verse: v,
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  })
  const next = { ...verse, id: 2, verse: 2 }
  useQueueStore.setState({
    items: [
      queueItem("a", "John 3:1", verse),
      queueItem("b", "John 3:2", next),
    ],
  })
  useBroadcastStore.setState({
    liveSourceVerse: verse,
    liveVerse: {
      reference: "John 3:1 (KJV · OYCB)",
      segments: [{ text: verse.text }],
    },
  })
  operatorActions.queueNext()
  expect(useQueueStore.getState().activeIndex).toBe(1)
})
it("modifier Enter presents a Queue row and clears only its selection", async () => {
  const item = {
    id: "queued",
    reference: "John 3:1",
    verse,
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  }
  useQueueStore.setState({ items: [item], activeIndex: null })
  document.body.innerHTML =
    '<section data-operator-list="queue"><article data-operator-item="queued" tabindex="0"><button data-operator-present>Present</button></article></section>'
  await runShortcutCommand(
    "list-present-clear",
    event(document.querySelector("article")!)
  )
  expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse)
  expect(useQueueStore.getState().activeIndex).toBeNull()
  expect(useQueueStore.getState().items).toEqual([item])
})
it("Queue insertion/removal/reorder preserve the active item identity", () => {
  const item = (id: string, n: number) => ({
    id,
    reference: `John 3:${n}`,
    verse: { ...verse, id: n, verse: n },
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  })
  const a = item("a", 1),
    b = item("b", 2),
    c = item("c", 3)
  useQueueStore.setState({ items: [a, b], activeIndex: 1 })
  useQueueStore.getState().addItem(c)
  expect(
    useQueueStore.getState().items[useQueueStore.getState().activeIndex!].id
  ).toBe("b")
  useQueueStore.getState().removeItem("a")
  expect(
    useQueueStore.getState().items[useQueueStore.getState().activeIndex!].id
  ).toBe("b")
  useQueueStore.getState().reorderItems(1, 0)
  expect(
    useQueueStore.getState().items[useQueueStore.getState().activeIndex!].id
  ).toBe("b")
  useQueueStore.getState().removeItem("b")
  expect(useQueueStore.getState().activeIndex).toBeNull()
})
it("allows S to stop an accepted transcription while its provider is connecting", async () => {
  const { useTranscriptStore } = await import("@/stores/transcript-store")
  useTranscriptStore.setState({
    isTranscribing: true,
    connectionStatus: "connecting",
  })
  await runShortcutCommand("toggle-transcription", event())
  expect(mocks.invoke).toHaveBeenCalledWith("stop_transcription")
  expect(useTranscriptStore.getState().isTranscribing).toBe(false)
})
it("does not issue duplicate starts while a start command is still pending", async () => {
  const { useTranscriptStore } = await import("@/stores/transcript-store")
  useTranscriptStore.setState({
    isTranscribing: false,
    connectionStatus: "disconnected",
  })
  let finish!: (value: undefined) => void
  mocks.invoke.mockImplementation(
    (command) => command === "read_transcription_start_revision" || command === "read_operator_session_revision" ? Promise.resolve(0) :
      new Promise<undefined>((resolve) => {
        finish = resolve
      })
  )
  const task = runShortcutCommand("toggle-transcription", event())
  await runShortcutCommand("toggle-transcription", event())
  await vi.waitFor(() => expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "start_transcription"
    )
  ).toHaveLength(1))
  finish(undefined)
  await task
})

it("blocks shared keyboard and direct operator actions during preference maintenance", async () => {
  useBibleStore.setState({followDetections:false})
  useQueueStore.setState({items:[{id:"held",verse:{...verse,verse:2},reference:"John 3:2",confidence:1,source:"manual",added_at:1}],activeIndex:null})
  const lease=beginOperatorMaintenance()
  try {
    await runShortcutCommand("show-commands",event())
    await runShortcutCommand("focus-search",event())
    operatorActions.addToQueue()
    operatorActions.setFollowDetections(true)
    operatorActions.toggleAutoLive()
    await operatorActions.presentQueueItem(0)
    expect(useOperatorUiStore.getState()).toMatchObject({commandsOpen:false,searchFocusRevision:0})
    expect(useQueueStore.getState()).toMatchObject({activeIndex:null,items:[expect.objectContaining({id:"held"})]})
    expect(useBibleStore.getState().followDetections).toBe(false)
    expect(useBroadcastStore.getState().autoLive).toBe(false)
  } finally {lease.release()}
})
