import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
import { presentVerse, toDualVerseRenderData } from "./use-broadcast"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))

const sampleVerse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 1,
  book_name: "Genesis",
  book_abbreviation: "Gen",
  chapter: 1,
  verse: 2,
  text: "The earth was without form and void.",
}

describe("presentVerse", () => {
  const staleVerse: Verse = {
    id: 0,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "",
    chapter: 3,
    verse: 16,
    text: "",
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    useBibleStore.setState({
      selectedVerse: null,
      activeTranslationId: 2,
      secondaryTranslationId: null,
      translations: [
        {
          id: 2,
          abbreviation: "NKJV",
          title: "New King James Version",
          language: "en",
          is_copyrighted: true,
          is_downloaded: true,
        },
      ],
    })
    useBroadcastStore.setState({ liveVerse: null, liveSourceVerse: null })
  })

  it("presents the refetched verse text, not the stale queue text", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      book_abbreviation: "Jn",
      text: "For God so loved the world",
    }
    mockInvoke.mockResolvedValue(fullVerse)

    await presentVerse(staleVerse)

    expect(useBibleStore.getState().selectedVerse?.text).toBe(
      "For God so loved the world"
    )
    const liveVerse = useBroadcastStore.getState().liveVerse
    expect(liveVerse?.reference).toBe("John 3:16 (NKJV)")
    expect(liveVerse?.segments[0].text).toBe("For God so loved the world")
  })

  it("looks up by book/chapter/verse against the active translation", async () => {
    mockInvoke.mockResolvedValue(null)

    await presentVerse(staleVerse)

    expect(mockInvoke).toHaveBeenCalledWith("get_verse", {
      translationId: 2, // active translation, not staleVerse.translation_id
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
  })

  it("falls back to the passed verse when the lookup returns null", async () => {
    mockInvoke.mockResolvedValue(null)

    await presentVerse(sampleVerse)

    expect(useBibleStore.getState().selectedVerse).toEqual(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      sampleVerse.text
    )
  })

  it("falls back to the passed verse when the lookup rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("db unavailable"))

    await expect(presentVerse(sampleVerse)).resolves.toBeUndefined()

    expect(useBibleStore.getState().selectedVerse).toEqual(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      sampleVerse.text
    )
  })

  it("records the presented verse as the live source verse", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    mockInvoke.mockResolvedValue(fullVerse)

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(fullVerse)
  })

  it("presents the active and secondary translations together", async () => {
    const english: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    const yoruba: Verse = {
      ...staleVerse,
      id: 76137,
      translation_id: 3,
      text: "Nitori Ọlọrun fẹ́ràn ayé",
    }
    useBibleStore.setState({
      secondaryTranslationId: 3,
      translations: [
        {
          id: 2,
          abbreviation: "NKJV",
          title: "New King James Version",
          language: "en",
          is_copyrighted: true,
          is_downloaded: true,
        },
        {
          id: 3,
          abbreviation: "OYCB",
          title: "Yorùbá Bible",
          language: "yo",
          is_copyrighted: false,
          is_downloaded: true,
        },
      ],
    })
    mockInvoke.mockImplementation(
      (command: unknown, args: { translationId?: number }) => {
        if (command !== "get_verse") return Promise.resolve(undefined)
        return Promise.resolve(args.translationId === 2 ? english : yoruba)
      }
    )

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveVerse).toMatchObject({
      reference: "John 3:16",
      segments: [{ text: "For God so loved the world" }],
      translationLines: [
        "For God so loved the world",
        "Nitori Ọlọrun fẹ́ràn ayé",
      ],
    })
  })

  it("refuses to present a verse with empty text (issue #141)", async () => {
    // Refetch finds nothing and the cached verse has no text (e.g. a cited
    // verse that doesn't exist) — the live output must not change.
    mockInvoke.mockResolvedValue(null)

    await presentVerse(staleVerse)

    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
  })

  it("refuses to replace the live verse with an empty one", async () => {
    const fullVerse: Verse = {
      ...staleVerse,
      id: 26137,
      translation_id: 2,
      text: "For God so loved the world",
    }
    // Route by command — mark() also calls invoke ("ui_mark"), so Once
    // queues would be consumed by instrumentation.
    let lookups = 0
    mockInvoke.mockImplementation((cmd: unknown) => {
      if (cmd !== "get_verse") return Promise.resolve(undefined)
      lookups += 1
      return Promise.resolve(lookups === 1 ? fullVerse : null)
    })

    await presentVerse(staleVerse)
    await presentVerse({ ...sampleVerse, text: "" })

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (NKJV)"
    )
  })

  it("ignores a stale refetch that resolves after a newer present call", async () => {
    const older: Verse = { ...sampleVerse, verse: 1, text: "In the beginning" }
    let resolveOlder: (v: Verse) => void = () => {}
    mockInvoke
      .mockImplementationOnce(
        () => new Promise<Verse>((resolve) => (resolveOlder = resolve))
      )
      .mockResolvedValueOnce(sampleVerse)

    const first = presentVerse(older)
    await presentVerse(sampleVerse)
    resolveOlder(older)
    await first

    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "Genesis 1:2 (NKJV)"
    )
  })
})

describe("toDualVerseRenderData", () => {
  it("keeps two translations on the same scripture reference", () => {
    const english = { ...sampleVerse, text: "In the beginning" }
    const yoruba = { ...sampleVerse, text: "Ni atetekọṣe" }

    const rendered = toDualVerseRenderData([
      { verse: english, translation: "KJV" },
      { verse: yoruba, translation: "OYCB" },
    ])

    expect(rendered.reference).toBe("Genesis 1:2")
    expect(rendered.segments).toEqual([{ text: "In the beginning" }])
    expect(rendered.translationLines).toEqual([
      "In the beginning",
      "Ni atetekọṣe",
    ])
  })
})
