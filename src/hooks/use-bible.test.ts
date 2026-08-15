import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { findLoadedVerse, stepVerse } from "./use-bible"
import { useBibleStore } from "@/stores/bible-store"

function verse(
  bookNumber: number,
  chapter: number,
  verseNumber: number,
  bookName = "John"
): Verse {
  return {
    id: bookNumber * 1_000_000 + chapter * 1_000 + verseNumber,
    translation_id: 1,
    book_number: bookNumber,
    book_name: bookName,
    book_abbreviation: bookName.slice(0, 3),
    chapter,
    verse: verseNumber,
    text: `${bookName} ${chapter}:${verseNumber}`,
  }
}

/** John 3, verses 1..10. */
const johnThree = Array.from({ length: 10 }, (_, i) => verse(43, 3, i + 1))

beforeEach(() => {
  mockInvoke.mockReset()
  useBibleStore.setState({
    activeTranslationId: 1,
    currentChapter: johnThree,
    selectedVerse: johnThree[4], // John 3:5
    pendingNavigation: null,
    revealRequest: 0,
    revealBlock: "nearest",
  })
})

describe("findLoadedVerse", () => {
  it("matches on book, chapter and verse together", () => {
    expect(
      findLoadedVerse(johnThree, { bookNumber: 43, chapter: 3, verse: 7 })?.verse
    ).toBe(7)
  })

  it("does not match a verse number from a different chapter", () => {
    expect(
      findLoadedVerse(johnThree, { bookNumber: 43, chapter: 4, verse: 7 })
    ).toBeNull()
  })

  it("returns null for a null target", () => {
    expect(findLoadedVerse(johnThree, null)).toBeNull()
  })
})

describe("stepVerse within a loaded chapter", () => {
  it("selects the next verse without any IPC round trip", async () => {
    await stepVerse("next")

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(6)
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("selects the previous verse without any IPC round trip", async () => {
    await stepVerse("prev")

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(4)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("asks the panel to reveal the verse it selected", async () => {
    await stepVerse("next")

    expect(useBibleStore.getState().revealRequest).toBe(1)
    expect(useBibleStore.getState().revealBlock).toBe("nearest")
  })

  it("enters the loaded chapter at the first verse when nothing is selected", async () => {
    useBibleStore.setState({ selectedVerse: null })

    await stepVerse("next")

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(1)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("enters the loaded chapter at the last verse when stepping back from nothing", async () => {
    useBibleStore.setState({ selectedVerse: null })

    await stepVerse("prev")

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(10)
  })

  it("does nothing when nothing is selected and no chapter is loaded", async () => {
    useBibleStore.setState({ selectedVerse: null, currentChapter: [] })

    await stepVerse("next")

    expect(useBibleStore.getState().selectedVerse).toBeNull()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe("stepVerse across a chapter boundary", () => {
  it("lands on the first verse of the next chapter", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[9] }) // John 3:10, last loaded
    const johnFour = Array.from({ length: 5 }, (_, i) => verse(43, 4, i + 1))
    mockInvoke.mockResolvedValue(johnFour)

    await stepVerse("next")

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 4,
      verse: 1,
    })
  })

  it("leaves the loaded chapter untouched — the probe never writes the store", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[9] })
    mockInvoke.mockResolvedValue([verse(43, 4, 1)])

    await stepVerse("next")

    expect(useBibleStore.getState().currentChapter).toBe(johnThree)
  })

  it("resolves the concrete last verse of the previous chapter, not a sentinel", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[0] }) // John 3:1
    const johnTwo = Array.from({ length: 25 }, (_, i) => verse(43, 2, i + 1))
    mockInvoke.mockResolvedValue(johnTwo)

    await stepVerse("prev")

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 2,
      verse: 25,
    })
  })

  it("does nothing at the end of a book — stepping never crosses into the next book", async () => {
    const malachiFour = Array.from({ length: 6 }, (_, i) => verse(39, 4, i + 1, "Malachi"))
    useBibleStore.setState({
      currentChapter: malachiFour,
      selectedVerse: malachiFour[5], // Malachi 4:6
    })
    mockInvoke.mockResolvedValue([]) // Malachi 5 does not exist

    await stepVerse("next")

    expect(useBibleStore.getState().pendingNavigation).toBeNull()
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(6)
    expect(useBibleStore.getState().currentChapter).toBe(malachiFour)
  })

  it("does nothing before Genesis 1:1, without any IPC round trip", async () => {
    const genesisOne = [verse(1, 1, 1, "Genesis"), verse(1, 1, 2, "Genesis")]
    useBibleStore.setState({
      currentChapter: genesisOne,
      selectedVerse: genesisOne[0],
    })

    await stepVerse("prev")

    expect(useBibleStore.getState().pendingNavigation).toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("leaves every piece of state untouched when the probe rejects", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[9] })
    mockInvoke.mockRejectedValue(new Error("db unavailable"))

    await expect(stepVerse("next")).resolves.toBeUndefined()

    expect(useBibleStore.getState().pendingNavigation).toBeNull()
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(10)
    expect(useBibleStore.getState().currentChapter).toBe(johnThree)
  })
})

describe("stepVerse under rapid presses", () => {
  it("advances from the in-flight target rather than the stale selection", async () => {
    useBibleStore.setState({
      pendingNavigation: { bookNumber: 43, chapter: 3, verse: 7 },
    })

    await stepVerse("next")

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 3,
      verse: 8,
    })
  })

  it("lets a corrective step in the loaded chapter cancel an in-flight crossing", async () => {
    // The operator overshoots at the end of a chapter, then immediately steps
    // back. The correction lands synchronously; the crossing it replaced must
    // not arrive afterwards and drag the panel into the next chapter.
    useBibleStore.setState({ selectedVerse: johnThree[9] }) // John 3:10

    let resolveStale: (v: Verse[]) => void = () => {}
    mockInvoke.mockImplementationOnce(
      () => new Promise<Verse[]>((resolve) => (resolveStale = resolve))
    )

    const stale = stepVerse("next")
    await new Promise((resolve) => setTimeout(resolve, 0))
    await stepVerse("prev")

    resolveStale([verse(43, 4, 1)])
    await stale

    expect(useBibleStore.getState().selectedVerse?.verse).toBe(9)
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  })

  it("lets the newer crossing win when an older probe resolves last", async () => {
    useBibleStore.setState({ selectedVerse: johnThree[9] }) // John 3:10, last loaded

    let resolveStale: (v: Verse[]) => void = () => {}
    mockInvoke
      .mockImplementationOnce(
        () => new Promise<Verse[]>((resolve) => (resolveStale = resolve))
      )
      .mockResolvedValue([verse(43, 4, 1)])

    const stale = stepVerse("next")
    // Let the first step get as far as its chapter probe before the second
    // starts, so the two are genuinely in flight together.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await stepVerse("next")

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 4,
      verse: 1,
    })

    // The stale probe lands afterwards carrying a different first verse — it
    // must not overwrite the navigation the newer step already committed.
    resolveStale([verse(43, 4, 3)])
    await stale

    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 4,
      verse: 1,
    })
  })
})
