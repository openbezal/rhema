import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
import {
  presentVerse,
  reservePresentationIntent,
  clearLive,
  invalidatePresentation,
  refreshLiveVerse,
  connectPresentationController,
  toVerseRenderData,
} from "./presentation-controller"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { beginOperatorMaintenance } from "./operator-maintenance"
const source: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Cached text in another translation",
}
const held = {
  reference: "Previously presented",
  segments: [{ text: "Held output" }],
}
beforeEach(() => {
  invalidatePresentation()
  mocks.emit.mockClear()
  mocks.invoke.mockReset().mockResolvedValue(null)
  useBibleStore.setState({
    activeTranslationId: 2,
    activeTranslationCode: "ESV",
    translationSelectionStatus: "ready",
    translations: [
      {
        id: 2,
        abbreviation: "ESV",
        title: "English Standard Version",
        language: "en",
        is_downloaded: true,
        is_copyrighted: true,
      },
    ],
    selectedVerse: null,
  })
  useBroadcastStore.setState({
    liveVerse: held,
    liveSourceVerse: null,
    isLive: true,
  })
})
describe("verified primary text", () => {
  it("attaches the verified primary address to the committed render payload", async () => {
    mocks.invoke.mockImplementation(async (command) =>
      command === "get_verse" ? resolved : null
    )
    await presentVerse(source)
    expect(useBroadcastStore.getState().liveVerse).toMatchObject({
      address: {
        bookNumber: 43,
        bookName: "John",
        chapter: 3,
        verse: 16,
        translationCode: "ESV",
      },
      segments: [{ verseNumber: 16, text: "Verified primary text" }],
    })
  })
  it("includes optional edition attribution in the shared preview/program address", () => {
    expect(
      toVerseRenderData(source, "ESV", {
        verse: { ...source, text: "Second" },
        code: "KJV",
      })
    ).toMatchObject({
      address: {
        bookNumber: 43,
        bookName: "John",
        chapter: 3,
        verse: 16,
        translationCode: "ESV",
        secondaryTranslationCode: "KJV",
      },
      secondary: {
        translationCode: "KJV",
        segments: [{ verseNumber: 16, text: "Second" }],
      },
    })
  })
  it.each([null, new Error("Lookup failed")])(
    "holds the prior verse when primary text cannot be resolved: %s",
    async (response) => {
      mocks.invoke.mockImplementation(async (command) => {
        if (command !== "get_verse") return null
        if (response instanceof Error) throw response
        return response
      })
      await presentVerse(source)
      expect(useBroadcastStore.getState().liveVerse).toEqual(held)
      expect(useBibleStore.getState().selectedVerse).toBeNull()
    }
  )
  it.each([
    { ...source, translation_id: 1 },
    { ...source, translation_id: 2, book_number: 45 },
    { ...source, translation_id: 2, chapter: 4 },
    { ...source, translation_id: 2, verse: 17 },
  ])(
    "rejects a resolved row that does not match the requested identity: %j",
    async (response) => {
      mocks.invoke.mockResolvedValue(response)
      await presentVerse(source)
      expect(useBroadcastStore.getState().liveVerse).toEqual(held)
    }
  )
  it("requires ready code and runtime metadata to agree before lookup", async () => {
    useBibleStore.setState({ activeTranslationCode: "KJV" })
    mocks.invoke.mockResolvedValue({ ...source, translation_id: 2 })
    await presentVerse(source)
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "get_verse",
      expect.anything()
    )
    expect(useBroadcastStore.getState().liveVerse).toEqual(held)
  })
})

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  invalidatePresentation()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const resolved = {
  ...source,
  id: 20,
  translation_id: 2,
  text: "Verified primary text",
}
const other = { ...resolved, id: 21, verse: 17, text: "Newer verse" }
const kjv = {
  id: 1,
  abbreviation: "KJV",
  title: "King James Version",
  language: "en",
  is_downloaded: true,
  is_copyrighted: false,
}

describe("shared presentation revision", () => {
  it("keeps a newer present when an older translation refresh resolves last", async () => {
    useBroadcastStore.setState({ liveSourceVerse: resolved })
    const old = deferred<Verse>()
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_verse" ? (args.verse === 16 ? old.promise : other) : null
    )
    const refreshing = refreshLiveVerse()
    await presentVerse(other)
    old.resolve(resolved)
    await refreshing
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(other)
    expect(useBibleStore.getState().selectedVerse).toEqual(other)
  })
  it.each(["transparent", "black", "background"] as const)(
    "invalidates pending lookup and synchronizes %s clear to every output",
    async (mode) => {
      const pendingVerse = deferred<Verse>()
      mocks.invoke.mockImplementation(async (command) =>
        command === "get_verse" ? pendingVerse.promise : null
      )
      const current = useBroadcastStore.getState().outputs[0]
      useBroadcastStore.setState({
        outputs: [current, { ...current, id: "second" }],
      })
      const pending = presentVerse(resolved)
      clearLive(mode)
      pendingVerse.resolve(resolved)
      await pending
      expect(useBroadcastStore.getState().liveVerse).toBeNull()
      expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
      expect(useBroadcastStore.getState().isLive).toBe(true)
      for (const id of [current.id, "second"]) {
        expect(mocks.emit).toHaveBeenLastCalledWith(
          expect.anything(),
          "broadcast:verse-update",
          expect.anything()
        )
        expect(mocks.emit).toHaveBeenCalledWith(
          `broadcast-${id}`,
          "broadcast:verse-update",
          expect.objectContaining({ verse: null, clearMode: mode })
        )
      }
      expect(mocks.invoke).not.toHaveBeenCalledWith(
        "stop_ndi",
        expect.anything()
      )
    }
  )
  it("applies an explicit clear while off air and retains it across theme synchronization", () => {
    useBroadcastStore.setState({ isLive: false })
    clearLive("black")
    const themeId = useBroadcastStore.getState().themes[0].id
    useBroadcastStore.getState().setActiveTheme(themeId)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    const updates = mocks.emit.mock.calls.filter(
      ([, event]) => event === "broadcast:verse-update"
    )
    expect(updates.length).toBeGreaterThan(0)
    expect(
      updates.every(
        ([, , payload]) =>
          payload.verse === null && payload.clearMode === "black"
      )
    ).toBe(true)
  })
  it("invalidates an old lookup on session reset while retaining prior live content", async () => {
    const verse = deferred<Verse>()
    mocks.invoke.mockImplementation(async (command) =>
      command === "get_verse" ? verse.promise : null
    )
    const pending = presentVerse(resolved)
    invalidatePresentation()
    verse.resolve(resolved)
    await pending
    expect(useBroadcastStore.getState().liveVerse).toEqual(held)
  })
  it("refreshes through the app controller without changing the browsed preview", async () => {
    useBroadcastStore.setState({ liveSourceVerse: resolved })
    useBibleStore.setState({
      selectedVerse: other,
      translations: [...useBibleStore.getState().translations, kjv],
    })
    cleanups.push(connectPresentationController())
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_verse"
        ? { ...resolved, translation_id: args.translationId }
        : null
    )
    useBibleStore.getState().setActiveTranslation(1)
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveSourceVerse?.translation_id).toBe(
        1
      )
    )
    expect(useBibleStore.getState().selectedVerse).toEqual(other)
  })
  it("resolves the first pending reference in the newly confirmed translation", async () => {
    useBibleStore.setState({
      translations: [...useBibleStore.getState().translations, kjv],
    })
    const old = deferred<Verse>()
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_verse"
        ? args.translationId === 2
          ? old.promise
          : { ...source, text: "New translation" }
        : null
    )
    cleanups.push(connectPresentationController())
    const pending = presentVerse(resolved)
    useBibleStore.getState().setActiveTranslation(1)
    try {
      await vi.waitFor(() =>
        expect(
          useBroadcastStore.getState().liveSourceVerse?.translation_id
        ).toBe(1)
      )
    } finally {
      old.resolve(resolved)
      await pending
    }
    expect(useBroadcastStore.getState().liveSourceVerse?.text).toBe(
      "New translation"
    )
  })
  it("cancels an on-air lookup after off, but permits a later explicit off-air present", async () => {
    cleanups.push(connectPresentationController())
    const old = deferred<Verse>()
    mocks.invoke.mockImplementation(async (command, args) =>
      command === "get_verse" ? (args.verse === 16 ? old.promise : other) : null
    )
    const pending = presentVerse(resolved)
    useBroadcastStore.getState().setLive(false)
    old.resolve(resolved)
    await pending
    expect(useBroadcastStore.getState().liveVerse).toEqual(held)
    await presentVerse(other)
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(other)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
  it("does not refresh after the controller disconnects", async () => {
    useBroadcastStore.setState({ liveSourceVerse: resolved })
    useBibleStore.setState({
      translations: [...useBibleStore.getState().translations, kjv],
    })
    const disconnect = connectPresentationController()
    disconnect()
    useBibleStore.getState().setActiveTranslation(1)
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "get_verse",
      expect.anything()
    )
  })
})

it("traces reserved operator intent before upstream chapter lookup delay", async () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(100)
    const intentRevision = reservePresentationIntent()
    vi.setSystemTime(600)
    mocks.invoke.mockImplementation(async (command) =>
      command === "get_verse" ? resolved : null
    )
    await presentVerse(resolved, { intentRevision })
    expect(useBroadcastStore.getState().liveTrace?.acceptedEpochMs).toBe(100)
  } finally {
    vi.useRealTimers()
  }
})

it("does not present or clear the committed frame during maintenance", async () => {
  const lease = beginOperatorMaintenance()
  try {
    await presentVerse(source)
    clearLive("transparent")
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(useBroadcastStore.getState().liveVerse).toEqual(held)
  } finally {
    lease.release()
  }
})

it("does not commit a lookup from before maintenance after its lease is released", async () => {
  let resolve!: (row: Verse) => void
  mocks.invoke.mockImplementation(
    () =>
      new Promise<Verse>((done) => {
        resolve = done
      })
  )
  const old = presentVerse(source)
  const lease = beginOperatorMaintenance()
  lease.release()
  resolve({ ...source, translation_id: 2, text: "obsolete lookup" })
  await old
  expect(useBroadcastStore.getState().liveVerse).toEqual(held)
})
