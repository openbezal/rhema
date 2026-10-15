import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: vi.fn().mockResolvedValue([]) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn().mockResolvedValue(true) }))

import { remoteActions } from "./remote-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"

const johnThreeSixteen: Verse = {
  id: 26137,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "For God so loved the world",
}

const genesisOneOne: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 1,
  text: "In the beginning",
}

function queueItemFor(verse: Verse) {
  return {
    id: crypto.randomUUID(),
    verse,
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
    confidence: 1,
    source: "manual" as const,
    added_at: Date.now(),
  }
}

beforeEach(() => {
  mockInvoke.mockReset()
  // The presentation boundary requires a verified database row, not a cached fallback.
  mockInvoke.mockImplementation(async (command, args) => {
    if (command !== "get_verse") return null
    return [...useBibleStore.getState().currentChapter, johnThreeSixteen, genesisOneOne].find(row =>
      row.translation_id === args.translationId && row.book_number === args.bookNumber && row.chapter === args.chapter && row.verse === args.verse) ?? null
  })
  useBibleStore.setState({
    selectedVerse: null,
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    currentChapter: [],
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "King James Version",
        language: "en",
        is_copyrighted: false,
        is_downloaded: true,
      },
    ],
  })
  useBroadcastStore.setState({ isLive: false, autoLive: false, liveVerse: null, liveSourceVerse: null })
  useQueueStore.setState({ items: [], activeIndex: null })
})

describe("remoteActions.sendToLive", () => {
  it("presents the previewed verse on the live output", async () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.sendToLive()
    await vi.waitFor(() =>
      expect(useBroadcastStore.getState().liveVerse).not.toBeNull(),
    )

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (KJV)",
    )
  })

  it("does nothing when no verse is previewed", async () => {
    remoteActions.sendToLive()
    await Promise.resolve()

    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalledWith("get_verse", expect.anything())
  })
})

describe("remoteActions.addToQueue", () => {
  it("queues the previewed verse with the panel's payload", () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.addToQueue()

    const { items } = useQueueStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0].reference).toBe("John 3:16")
    expect(items[0].source).toBe("manual")
    expect(items[0].confidence).toBe(1)
    expect(items[0].verse).toEqual(johnThreeSixteen)
  })

  it("is safe to press twice — the second press adds nothing", () => {
    useBibleStore.setState({ selectedVerse: johnThreeSixteen })

    remoteActions.addToQueue()
    remoteActions.addToQueue()

    expect(useQueueStore.getState().items).toHaveLength(1)
  })

  it("does nothing when no verse is previewed", () => {
    remoteActions.addToQueue()

    expect(useQueueStore.getState().items).toHaveLength(0)
  })
})

describe("remoteActions queue navigation", () => {
  it("clamps at the end of the queue", () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 1,
    })

    remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBe(1)
  })

  it("clamps at the start of the queue", () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    remoteActions.queuePrev()

    expect(useQueueStore.getState().activeIndex).toBe(0)
  })

  it("advances through the queue", () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBe(1)
  })

  it("does nothing on an empty queue", () => {
    remoteActions.queueNext()

    expect(useQueueStore.getState().activeIndex).toBeNull()
  })
})

describe("remoteActions bible navigation", () => {
  const johnThree = Array.from({ length: 10 }, (_, i) => ({
    ...johnThreeSixteen,
    id: 1000 + i,
    verse: i + 1,
  }))

  beforeEach(() => {
    useBibleStore.setState({
      currentChapter: johnThree,
      selectedVerse: johnThree[4], // John 3:5
      pendingNavigation: null,
      revealRequest: 0,
    })
  })

  it("steps the Bible panel forward one verse", async () => {
    await remoteActions.bibleNext()

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(6)
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse?.verse).toBe(6))
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("steps the Bible panel back one verse", async () => {
    await remoteActions.biblePrev()

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(4)
    await vi.waitFor(() => expect(useBroadcastStore.getState().liveSourceVerse?.verse).toBe(4))
  })

  it("carries presentation through a chapter boundary", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[9] })
    mockInvoke.mockResolvedValue([{ ...johnThree[0], chapter: 4, verse: 1 }])

    await remoteActions.bibleNext()

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43, chapter: 4, verse: 1, present: true,
    })
  })

  it("keeps the current live verse when chapter lookup fails", async () => {
    useBroadcastStore.setState({ liveSourceVerse: genesisOneOne, isLive: true })
    useBibleStore.setState({ selectedVerse: johnThree[9] })
    mockInvoke.mockRejectedValue(new Error("database unavailable"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await remoteActions.bibleNext()
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(genesisOneOne)
      expect(useBroadcastStore.getState().isLive).toBe(true)
      expect(useBibleStore.getState().pendingNavigation).toBeNull()
    } finally { warn.mockRestore() }
  })

  it("does not move the queue — that is the whole point of RC-04", async () => {
    useQueueStore.setState({
      items: [queueItemFor(genesisOneOne), queueItemFor(johnThreeSixteen)],
      activeIndex: 0,
    })

    await remoteActions.bibleNext()
    await remoteActions.biblePrev()

    expect(useQueueStore.getState().activeIndex).toBe(0)
    expect(useQueueStore.getState().items).toHaveLength(2)
  })

  it("does nothing with no chapter loaded and nothing selected", async () => {
    useBibleStore.setState({ currentChapter: [], selectedVerse: null })

    await remoteActions.bibleNext()

    expect(useBibleStore.getState().selectedVerse).toBeNull()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  })
})

describe("remoteActions.toggleOnAir", () => {
  it("sets the live flag to the value it is given", async () => {
    await remoteActions.toggleOnAir(true)
    expect(useBroadcastStore.getState().isLive).toBe(true)

    await remoteActions.toggleOnAir(false)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
})
