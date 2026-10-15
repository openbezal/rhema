import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn().mockResolvedValue([]),
}))
vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(true),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { connectBibleNavigation } from "./bible-navigation"
import { remoteActions } from "./remote-actions"
import { stepVerse } from "@/hooks/use-bible"
import {
  clearLive,
  connectPresentationController,
  invalidatePresentation,
  presentVerse,
} from "./presentation-controller"
const row = (chapter: number): Verse => ({
  id: chapter,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter,
  verse: 1,
  text: `Verified John ${chapter}:1`,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const cleanups: (() => void)[] = []
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  invalidatePresentation()
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    isLive: true,
  })
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
    selectedVerse: row(3),
    currentChapter: [row(3)],
    pendingNavigation: null,
  })
  mocks.invoke
    .mockReset()
    .mockImplementation(async (command, args) =>
      command === "get_verse"
        ? row(args.chapter)
        : command === "get_ndi_status"
          ? { active: false }
          : null
    )
  cleanups.push(connectPresentationController(), connectBibleNavigation())
})
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn())
  invalidatePresentation()
})
describe("presentation intent across upstream actions", () => {
  it.each(["transparent", "black", "background"] as const)(
    "retains explicit %s clear across off/on without seeding old preview",
    async (mode) => {
      clearLive(mode)
      await remoteActions.toggleOnAir(false)
      await remoteActions.toggleOnAir(true)
      await settle()
      expect(useBroadcastStore.getState().isLive).toBe(true)
      expect(useBroadcastStore.getState().liveVerse).toBeNull()
      expect(useBroadcastStore.getState().clearMode).toBe(mode)
      expect(mocks.invoke).not.toHaveBeenCalledWith(
        "get_verse",
        expect.anything()
      )
    }
  )
  it.each(["clear", "new present", "off air"] as const)(
    "rejects a pending present-navigation after %s",
    async (action) => {
      const chapter = deferred<Verse[]>()
      mocks.invoke.mockImplementation(async (command, args) =>
        command === "get_chapter"
          ? chapter.promise
          : command === "get_verse"
            ? row(args.chapter)
            : null
      )
      useBibleStore.getState().setPendingNavigation({
        bookNumber: 43,
        chapter: 4,
        verse: 1,
        present: true,
      })
      if (action === "clear") clearLive("black")
      else if (action === "new present") await presentVerse(row(5))
      else await remoteActions.toggleOnAir(false)
      chapter.resolve([row(4)])
      await settle()
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(
        action === "new present" ? row(5) : null
      )
      expect(useBibleStore.getState().pendingNavigation).toBeNull()
    }
  )
  it("does not start a stale presentation after a delayed step boundary probe", async () => {
    const chapter = deferred<Verse[]>()
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_chapter"
        ? chapter.promise
        : command === "get_verse"
          ? row(args.chapter)
          : null
    )
    const step = stepVerse("next", { present: true })
    await Promise.resolve()
    clearLive("transparent")
    chapter.resolve([row(4)])
    await step
    await settle()
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  })
  it("reserves a navigation intent before lookup, cancelling an older direct present", async () => {
    const old = deferred<Verse>()
    const chapter = deferred<Verse[]>()
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_chapter"
        ? chapter.promise
        : command === "get_verse"
          ? args.chapter === 5
            ? old.promise
            : row(args.chapter)
          : null
    )
    const pending = presentVerse(row(5))
    useBibleStore.getState().setPendingNavigation({
      bookNumber: 43,
      chapter: 4,
      verse: 1,
      present: true,
    })
    old.resolve(row(5))
    await pending
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    chapter.resolve([row(4)])
    await settle()
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(row(4))
  })
})
