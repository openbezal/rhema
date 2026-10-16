// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import { runShortcutCommand } from "@/lib/operator-shortcuts"
import { browsePaletteReference } from "@/lib/operator-palette"
import { connectBibleNavigation } from "@/lib/bible-navigation"
import {
  clearLive,
  invalidatePresentation,
} from "@/lib/presentation-controller"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
const v = (chapter = 3) => ({
  id: chapter,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter,
  verse: 1,
  text: "Scripture",
})
beforeEach(() => {
  invalidatePresentation()
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    secondaryTranslationCode: null,
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
    selectedVerse: v(),
    currentChapter: [v()],
    pendingNavigation: null,
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
  })
  useBroadcastStore.setState({
    isLive: true,
    liveVerse: null,
    liveSourceVerse: null,
  })
  mock.invoke
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "get_chapter"
        ? [v(args.chapter)]
        : command === "get_verse"
          ? v(args.chapter)
          : null
    )
})
it("older buffered bracket must not undo a later explicit clear", async () => {
  let release!: (rows: unknown[]) => void
  mock.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const disconnect = connectBibleNavigation()
  try {
    const first = runShortcutCommand(
      "next-chapter",
      new KeyboardEvent("keydown")
    )
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    const second = runShortcutCommand(
      "next-chapter",
      new KeyboardEvent("keydown")
    )
    clearLive("black")
    release([v(4)])
    await Promise.all([first, second])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
  } finally {
    disconnect()
  }
})
it.each(["I John", "1 John"])(
  "full numeric name works against %s catalog",
  async (name) => {
    useBibleStore.setState({
      books: [
        {
          id: 62,
          translation_id: 1,
          book_number: 62,
          name,
          abbreviation: "1John",
          testament: "NT",
        },
      ],
    })
    mock.invoke.mockResolvedValue({ ...v(1), book_number: 62, book_name: name })
    await browsePaletteReference("1 John 1:1")
    expect(useBibleStore.getState().pendingNavigation?.bookNumber).toBe(62)
  }
)
it("stale ModEnter must not clear a newer ordinary presentation selection", async () => {
  const { useQueueStore } = await import("@/stores/queue-store")
  const { operatorActions } = await import("@/lib/operator-actions")
  const item = {
    id: "a",
    verse: v(),
    reference: "John 3:1",
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  }
  useQueueStore.setState({ items: [item], activeIndex: 0 })
  useBroadcastStore.setState({ liveSourceVerse: v() })
  document.body.innerHTML =
    '<section data-operator-list="queue"><article data-operator-item="a" tabindex="0"></article></section>'
  const event = new KeyboardEvent("keydown", { bubbles: true })
  document.querySelector("article")!.dispatchEvent(event)
  let finishOld!: (value: unknown) => void
  let firstLookup = true
  mock.invoke.mockImplementation(async (command, args) => {
    if (command === "get_verse" && firstLookup) {
      firstLookup = false
      return new Promise((resolve) => {
        finishOld = resolve
      })
    }
    return command === "get_verse" ? v(args.chapter) : null
  })
  const old = runShortcutCommand("list-present-clear", event)
  await operatorActions.presentQueueItem(0)
  expect(useQueueStore.getState().activeIndex).toBe(0)
  finishOld(v())
  await old
  expect(useQueueStore.getState().activeIndex).toBe(0)
})

it("keeps rapid chapter steps in order when no newer operator intent intervenes", async () => {
  const disconnect = connectBibleNavigation()
  try {
    await Promise.all([
      runShortcutCommand("next-chapter", new KeyboardEvent("keydown")),
      runShortcutCommand("next-chapter", new KeyboardEvent("keydown")),
    ])
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse?.chapter).toBe(5)
    )
  } finally {
    disconnect()
  }
})
it("a fresh key after Clear does not wait for an abandoned chapter lookup", async () => {
  let release!: (rows: unknown[]) => void
  mock.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const disconnect = connectBibleNavigation()
  try {
    const first = runShortcutCommand(
      "next-chapter",
      new KeyboardEvent("keydown")
    )
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    clearLive("black")
    const fresh = runShortcutCommand(
      "next-chapter",
      new KeyboardEvent("keydown")
    )
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse?.chapter).toBe(4)
    )
    release([v(4)])
    await Promise.all([first, fresh])
    expect(useBroadcastStore.getState().liveSourceVerse?.chapter).toBe(4)
  } finally {
    disconnect()
  }
})
it.each([
  ["I John", "1Jn", "1Jn1:1"],
  ["1 John", "1Jn", "I John 1:1"],
  ["II John", "2Jn", "2 Jn 1:1"],
  ["3 John", "III Jn", "III Jn 1:1"],
])(
  "resolves complete numbered abbreviations: %s / %s / %s",
  async (name, abbreviation, input) => {
    useBibleStore.setState({
      books: [
        {
          id: 62,
          translation_id: 1,
          book_number: 62,
          name,
          abbreviation,
          testament: "NT",
        },
      ],
    })
    mock.invoke.mockResolvedValue({ ...v(1), book_number: 62, book_name: name })
    await browsePaletteReference(input)
    expect(useBibleStore.getState().pendingNavigation?.bookNumber).toBe(62)
  }
)
it("rejects an exact normalized numbered name shared by two catalog books", async () => {
  useBibleStore.setState({
    books: [
      {
        id: 62,
        translation_id: 1,
        book_number: 62,
        name: "I John",
        abbreviation: "1Jn",
        testament: "NT",
      },
      {
        id: 63,
        translation_id: 1,
        book_number: 63,
        name: "1 John",
        abbreviation: "Other",
        testament: "NT",
      },
    ],
  })
  await expect(browsePaletteReference("1 John 1:1")).rejects.toThrow()
  expect(mock.invoke).not.toHaveBeenCalled()
})
it("a failed ModEnter lookup leaves selection even when the old live coordinates match", async () => {
  const { useQueueStore } = await import("@/stores/queue-store")
  const item = {
    id: "failed",
    verse: v(),
    reference: "John 3:1",
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  }
  useQueueStore.setState({ items: [item], activeIndex: 0 })
  useBroadcastStore.setState({ liveSourceVerse: v() })
  document.body.innerHTML =
    '<section data-operator-list="queue"><article data-operator-item="failed" tabindex="0"></article></section>'
  const event = new KeyboardEvent("keydown", { bubbles: true })
  document.querySelector("article")!.dispatchEvent(event)
  mock.invoke.mockResolvedValue(null)
  await runShortcutCommand("list-present-clear", event)
  expect(useQueueStore.getState().activeIndex).toBe(0)
})

it("ModEnter clears its selection at the verified primary commit while secondary text is still pending", async () => {
  const { useQueueStore } = await import("@/stores/queue-store")
  const item = {
    id: "bilingual",
    verse: v(),
    reference: "John 3:1",
    confidence: 1,
    source: "manual" as const,
    added_at: 0,
  }
  useQueueStore.setState({ items: [item], activeIndex: 0 })
  const primary = useBibleStore.getState().translations[0]
  useBibleStore.setState({
    translations: [primary, { ...primary, id: 2, abbreviation: "OYCB" }],
    secondaryTranslationCode: "OYCB",
  })
  document.body.innerHTML =
    '<section data-operator-list="queue"><article data-operator-item="bilingual" tabindex="0"></article></section>'
  const event = new KeyboardEvent("keydown", { bubbles: true })
  document.querySelector("article")!.dispatchEvent(event)
  let finishSecondary!: (value: unknown) => void
  mock.invoke.mockImplementation(async (command, args) => {
    if (command !== "get_verse") return null
    if (args.translationId === 2)
      return new Promise((resolve) => {
        finishSecondary = resolve
      })
    return v()
  })
  const action = runShortcutCommand("list-present-clear", event)
  try {
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse?.translation_id).toBe(
        1
      )
    )
    expect(finishSecondary).toBeTypeOf("function")
    await vi.waitFor(() =>
      expect(useQueueStore.getState().activeIndex).toBeNull()
    )
  } finally {
    finishSecondary({ ...v(), translation_id: 2 })
    await action
  }
})
