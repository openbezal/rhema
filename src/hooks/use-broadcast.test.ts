import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
import { deriveLiveVerse, presentVerse } from "./use-broadcast"
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

describe("deriveLiveVerse", () => {
  it("returns null when live output is off", () => {
    const result = deriveLiveVerse({
      isLive: false,
      selectedVerse: sampleVerse,
      translation: "NKJV",
    })

    expect(result).toBeNull()
  })

  it("returns verse render data when live output is on", () => {
    const result = deriveLiveVerse({
      isLive: true,
      selectedVerse: sampleVerse,
      translation: "NKJV",
    })

    expect(result).toEqual(
      expect.objectContaining({
        reference: "Genesis 1:2 (NKJV)",
      }),
    )
  })
})

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
    useBroadcastStore.setState({ liveVerse: null })
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
      "For God so loved the world",
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
      sampleVerse.text,
    )
  })

  it("falls back to the passed verse when the lookup rejects", async () => {
    mockInvoke.mockRejectedValue(new Error("db unavailable"))

    await expect(presentVerse(sampleVerse)).resolves.toBeUndefined()

    expect(useBibleStore.getState().selectedVerse).toEqual(sampleVerse)
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      sampleVerse.text,
    )
  })
})
