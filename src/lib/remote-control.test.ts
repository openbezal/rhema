import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const { mockListen, mockInvoke, handlers } = vi.hoisted(() => ({
  mockListen: vi.fn(),
  mockInvoke: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

import { connectBibleNavigation } from "./bible-navigation"
import { connectRemoteControl } from "./remote-control"
import { beginOperatorMaintenance } from "./operator-maintenance"
import { acceptSessionReset } from "./session-revision"
import { syncStatusSnapshot } from "@/hooks/use-remote-control"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"

const cleanups: (() => void)[] = []
const unlisten = vi.fn()
function send(event: string, payload: unknown = {}, revision = 0) {
  const handler = handlers.get(`session:${event}`)
  expect(handler, `registered ${event}`).toBeDefined()
  handler?.({ payload: { revision, payload } })
}
async function connect() {
  cleanups.push(connectRemoteControl())
  await vi.waitFor(() =>
    expect(handlers.has("session:remote:confidence")).toBe(true)
  )
}

beforeEach(() => {
  handlers.clear()
  unlisten.mockReset()
  mockListen.mockReset().mockImplementation((event, handler) => {
    handlers.set(event, handler)
    return Promise.resolve(unlisten)
  })
  mockInvoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "read_operator_session_revision" ? 0 : null
    )
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    translationSelectionStatus: "ready",
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
    currentChapter: [],
    selectedVerse: null,
    pendingNavigation: null,
  })
  useBroadcastStore.setState({
    autoLive: false,
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
  })
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

describe("app-owned remote control", () => {
  it("reports the Auto display state for HTTP controller feedback", () => {
    useBroadcastStore.setState({ autoLive: true })
    syncStatusSnapshot()
    expect(mockInvoke).toHaveBeenCalledWith(
      "update_remote_status",
      expect.objectContaining({ autoBroadcast: true })
    )
  })

  it("toggles the same Auto display state with successive triggers", async () => {
    await connect()
    send("remote:auto_broadcast")
    expect(useBroadcastStore.getState().autoLive).toBe(true)
    send("remote:auto_broadcast")
    expect(useBroadcastStore.getState().autoLive).toBe(false)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("accepts object/JSON setters and makes repeated on requests idempotent", async () => {
    await connect()
    send("remote:set_auto_broadcast", { active: true })
    send("remote:set_auto_broadcast", '{"active":true}')
    expect(useBroadcastStore.getState().autoLive).toBe(true)
    for (const payload of [
      { active: "false" },
      "null",
      "invalid",
      [],
      { active: 0 },
    ]) {
      send("remote:set_auto_broadcast", payload)
      expect(useBroadcastStore.getState().autoLive).toBe(true)
    }
    send("remote:set_auto_broadcast", { active: false })
    expect(useBroadcastStore.getState().autoLive).toBe(false)
  })

  it("presents a remote next verse through the actual event and action", async () => {
    const first: Verse = {
      id: 1,
      translation_id: 1,
      book_number: 1,
      book_name: "Genesis",
      book_abbreviation: "Gen",
      chapter: 1,
      verse: 1,
      text: "First verse",
    }
    const second = { ...first, id: 2, verse: 2, text: "Second verse" }
    mockInvoke.mockImplementation(async (command, args) =>
      command === "get_verse"
        ? ([first, second].find((row) => row.verse === args.verse) ?? null)
        : null
    )
    useBibleStore.setState({
      currentChapter: [first, second],
      selectedVerse: first,
      pendingNavigation: null,
    })
    await connect()
    send("remote:bible_next")
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(second)
    )
    send("remote:bible_prev")
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(first)
    )
  })

  it.each([
    ["remote:bible_next", "remote:bible_next", 4, 2],
    ["remote:bible_next", "remote:bible_prev", 3, 1],
    ["remote:bible_prev", "remote:bible_prev", 2, 1],
  ])(
    "preserves overlapping %s then %s triggers",
    async (firstEvent, secondEvent, expectedChapter, expectedVerse) => {
      const makeVerse = (chapter: number, verse: number): Verse => ({
        id: chapter * 10 + verse,
        translation_id: 1,
        book_number: 43,
        book_name: "John",
        book_abbreviation: "Jn",
        chapter,
        verse,
        text: `John ${chapter}:${verse}`,
      })
      const chapters = new Map([
        [2, [makeVerse(2, 1), makeVerse(2, 2)]],
        [3, [makeVerse(3, 1)]],
        [4, [makeVerse(4, 1), makeVerse(4, 2)]],
      ])
      useBibleStore.setState({
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
        currentChapter: chapters.get(3),
        selectedVerse: makeVerse(3, 1),
        pendingNavigation: null,
      })
      let finish!: () => void
      let firstProbe = true
      mockInvoke.mockImplementation((command, args) => {
        if (command === "get_verse")
          return Promise.resolve(
            chapters
              .get(args.chapter)
              ?.find((row) => row.verse === args.verse) ?? null
          )
        if (command !== "get_chapter") return Promise.resolve(null)
        const rows = chapters.get(args.chapter) ?? []
        if (!firstProbe) return Promise.resolve(rows)
        firstProbe = false
        return new Promise<Verse[]>((resolve) => {
          finish = () => resolve(rows)
        })
      })
      cleanups.push(connectBibleNavigation())
      await connect()
      send(firstEvent)
      send(secondEvent)
      await vi.waitFor(() => expect(finish).toBeDefined())
      finish()
      await vi.waitFor(() =>
        expect(useBroadcastStore.getState().liveSourceVerse).toEqual(
          makeVerse(expectedChapter, expectedVerse)
        )
      )
    }
  )

  it("disposes a listener whose registration resolves after unmount", async () => {
    let finish!: (cleanup: () => void) => void
    mockListen.mockImplementationOnce((event, handler) => {
      handlers.set(event, handler)
      return new Promise<() => void>((resolve) => {
        finish = resolve
      })
    })
    const disconnect = connectRemoteControl()
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    disconnect()
    const lateUnlisten = vi.fn()
    finish(lateUnlisten)
    await vi.waitFor(() => expect(lateUnlisten).toHaveBeenCalledOnce())
    send("remote:show")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("registers other controls even if one subscription rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockListen.mockRejectedValueOnce(new Error("registration failed"))
    try {
      await connect()
      send("remote:set_auto_broadcast", { active: true })
      expect(useBroadcastStore.getState().autoLive).toBe(true)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it("unsubscribes each listener once and ignores queued events after cleanup", async () => {
    await connect()
    const disconnect = cleanups.pop()
    disconnect?.()
    disconnect?.()
    expect(unlisten).toHaveBeenCalledTimes(14)
    send("remote:on_air", { active: true })
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})

it("pauses remote commands and does not replay their old callbacks after maintenance", async () => {
  await connect()
  useBroadcastStore.setState({ autoLive: false })
  const old = handlers.get("session:remote:set_auto_broadcast")!
  const lease = beginOperatorMaintenance()
  try {
    old({ payload: { revision: 0, payload: { active: true } } })
    expect(useBroadcastStore.getState().autoLive).toBe(false)
    lease.release()
    await Promise.resolve()
    old({ payload: { revision: 0, payload: { active: true } } })
    expect(useBroadcastStore.getState().autoLive).toBe(false)
    send("remote:set_auto_broadcast", { active: true })
    expect(useBroadcastStore.getState().autoLive).toBe(true)
  } finally {
    lease.release()
  }
})

it("rejects a pre-reset remote packet delivered to a replacement listener", async () => {
  await connect()
  const lease = beginOperatorMaintenance()
  acceptSessionReset(0, 1)
  lease.release()
  await Promise.resolve()
  send("remote:set_auto_broadcast", { active: true }, 0)
  expect(useBroadcastStore.getState().autoLive).toBe(false)
  send("remote:set_auto_broadcast", { active: true }, 1)
  expect(useBroadcastStore.getState().autoLive).toBe(true)
})
