import { beforeEach, describe, expect, it, vi } from "vitest"

const emitToMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: emitToMock,
}))

const sampleLiveVerse = {
  reference: "John 3:16",
  segments: [{ text: "For God so loved the world", verseNumber: 16 }],
}

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("syncBroadcastOutput emits current theme and verse to broadcast window when live", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({
      activeThemeId: theme.id,
      isLive: true,
      liveVerse: sampleLiveVerse,
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(2)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-alt",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
  })

  it("syncBroadcastOutput emits null verse when not live, even with a live verse set", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({
      isLive: false,
      liveVerse: sampleLiveVerse,
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(2)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({ verse: null }),
    )
  })

  it("setLive pushes the persisted live verse to outputs when toggled on", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ isLive: false, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().setLive(true)

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
  })

  it("setLive blanks the outputs when toggled off without clearing the stored verse", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().setLive(false)

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({ verse: null }),
    )
    expect(useBroadcastStore.getState().liveVerse).toEqual(sampleLiveVerse)
  })

  it("autoLive defaults to on and can be toggled", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")

    expect(useBroadcastStore.getState().autoLive).toBe(true)

    useBroadcastStore.getState().setAutoLive(false)
    expect(useBroadcastStore.getState().autoLive).toBe(false)
  })

  it("setLiveVerse records the source verse for re-presentation", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const source = {
      id: 1,
      translation_id: 1,
      book_number: 43,
      book_name: "John",
      book_abbreviation: "Jhn",
      chapter: 3,
      verse: 16,
      text: "For God so loved the world",
    }

    useBroadcastStore.getState().setLiveVerse(sampleLiveVerse, source)

    expect(useBroadcastStore.getState().liveVerse).toEqual(sampleLiveVerse)
    expect(useBroadcastStore.getState().liveSourceVerse).toEqual(source)
  })
})
