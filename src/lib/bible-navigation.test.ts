import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const { mockInvoke, mockChapter } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockChapter: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))
import { connectBibleNavigation } from "./bible-navigation"
import { remoteActions } from "./remote-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

const verse = (chapter: number, number = 1): Verse => ({ id: chapter * 10 + number, translation_id: 1, book_number: 43, book_name: "John", book_abbreviation: "Jn", chapter, verse: number, text: `John ${chapter}:${number}` })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const cleanups: (() => void)[] = []
function connect() { const stop = connectBibleNavigation(); cleanups.push(stop); return stop }
const navigate = (chapter: number) => useBibleStore.getState().setPendingNavigation({ bookNumber: 43, chapter, verse: 1, present: true })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  mockChapter.mockReset().mockImplementation((args) => Promise.resolve([verse(args.chapter)]))
  mockInvoke.mockReset().mockImplementation((command, args) => command === "get_chapter" ? mockChapter(args) : Promise.resolve(command === "get_verse" && args.bookNumber === 43 ? verse(args.chapter, args.verse) : null))
  useBibleStore.setState({ books: [{ id: 43, translation_id: 1, book_number: 43, name: "John", abbreviation: "Jn", testament: "NT" }], currentChapter: [verse(3)], selectedVerse: verse(3), activeTranslationId: 1, activeTranslationCode: "KJV", translationSelectionStatus: "ready", translations: [{ id: 1, abbreviation: "KJV", title: "King James Version", language: "en", is_downloaded: true, is_copyrighted: false }], pendingNavigation: null, revealRequest: 0 })
  useBroadcastStore.setState({ liveVerse: null, liveSourceVerse: null })
})
afterEach(() => cleanups.splice(0).forEach((stop) => stop()))

describe("app-owned Bible navigation", () => {
  it("presents remote chapter crossings without a mounted Bible panel", async () => {
    connect()
    await remoteActions.bibleNext()
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse(4)))
    await remoteActions.biblePrev()
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse(3)))
  })

  it("prevents an older chapter from overwriting a newer landing", async () => {
    const old = deferred<Verse[]>()
    mockChapter.mockImplementationOnce(() => old.promise)
    connect()
    navigate(4)
    navigate(5)
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse(5)))
    old.resolve([verse(4)])
    await settle()
    expect(useBibleStore.getState().currentChapter).toEqual([verse(5)])
    expect(useBibleStore.getState().selectedVerse).toEqual(verse(5))
  })

  it("rejects a pending load after disconnect and lets a fresh mount finish it", async () => {
    const old = deferred<Verse[]>()
    mockChapter.mockImplementationOnce(() => old.promise)
    const stop = connect()
    navigate(4)
    stop()
    connect()
    await vi.waitFor(() => expect(useBibleStore.getState().pendingNavigation).toBeNull())
    useBibleStore.getState().selectVerse(verse(5))
    old.resolve([verse(4)])
    await settle()
    expect(useBibleStore.getState().selectedVerse).toEqual(verse(5))
  })

  it("ignores a cancelled request instead of presenting it later", async () => {
    const old = deferred<Verse[]>()
    mockChapter.mockImplementationOnce(() => old.promise)
    connect()
    navigate(4)
    useBibleStore.getState().setPendingNavigation(null)
    old.resolve([verse(4)])
    await settle()
    expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
    expect(useBibleStore.getState().currentChapter).toEqual([verse(3)])
  })

  it("chains rapid remote presses from the pending target", async () => {
    const old = deferred<Verse[]>()
    const chapterFour = [verse(4), verse(4, 2), verse(4, 3)]
    mockChapter.mockResolvedValue(chapterFour)
      .mockResolvedValueOnce(chapterFour)
      .mockImplementationOnce(() => old.promise)
    connect()
    await remoteActions.bibleNext()
    await remoteActions.bibleNext()
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse(4, 2)))
    old.resolve(chapterFour)
    await settle()
    expect(useBibleStore.getState().selectedVerse).toEqual(verse(4, 2))
  })

  it("retains live content and clears a failed request", async () => {
    useBroadcastStore.setState({ liveSourceVerse: verse(3) })
    mockChapter.mockRejectedValueOnce(new Error("database unavailable"))
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      connect()
      navigate(4)
      await vi.waitFor(() => expect(useBibleStore.getState().pendingNavigation).toBeNull())
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse(3))
      expect(useBibleStore.getState().currentChapter).toEqual([verse(3)])
    } finally { error.mockRestore() }
  })
})
