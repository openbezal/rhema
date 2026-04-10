import { beforeEach, describe, expect, it, vi } from "vitest"

const { emitToMock } = vi.hoisted(() => ({
  emitToMock: vi.fn(),
}))

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: emitToMock,
}))

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("syncBroadcastOutput emits current theme and verse to broadcast window", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({
      activeThemeId: theme.id,
      liveVerse: {
      reference: "John 3:16",
        segments: [{ text: "For God so loved the world", verseNumber: 16 }],
      },
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
  })

  it("uses the draft theme for broadcast output while editing the active theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    const draftTheme = {
      ...theme,
      layout: {
        ...theme.layout,
        offsetX: 140,
        offsetY: -60,
      },
    }

    useBroadcastStore.setState({
      activeThemeId: theme.id,
      editingThemeId: theme.id,
      draftTheme,
      liveVerse: {
        reference: "John 3:16",
        segments: [{ text: "For God so loved the world", verseNumber: 16 }],
      },
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({
          id: theme.id,
          layout: expect.objectContaining({
            offsetX: 140,
            offsetY: -60,
          }),
        }),
      }),
    )
  })

  it("re-syncs broadcast output when an active theme draft changes", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]

    useBroadcastStore.setState({
      activeThemeId: theme.id,
      editingThemeId: theme.id,
      draftTheme: theme,
      liveVerse: {
        reference: "John 3:16",
        segments: [{ text: "For God so loved the world", verseNumber: 16 }],
      },
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().updateDraftNested("layout.offsetX", 220)

    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({
          layout: expect.objectContaining({
            offsetX: 220,
          }),
        }),
      }),
    )
  })
})
