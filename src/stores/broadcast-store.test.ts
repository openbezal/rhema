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

  it("renames both the saved theme and the current draft", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]

    useBroadcastStore.setState({
      editingThemeId: theme.id,
      draftTheme: theme,
    })

    useBroadcastStore.getState().renameTheme(theme.id, "New Theme Name")

    const state = useBroadcastStore.getState()
    expect(state.themes.find((entry) => entry.id === theme.id)?.name).toBe("New Theme Name")
    expect(state.draftTheme?.name).toBe("New Theme Name")
  })

  it("falls back to the first remaining theme when deleting the active theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const [firstTheme] = useBroadcastStore.getState().themes
    useBroadcastStore.getState().duplicateTheme(firstTheme.id)
    const customTheme = useBroadcastStore.getState().themes.find((theme) => !theme.builtin)

    expect(customTheme).toBeTruthy()

    useBroadcastStore.setState({
      activeThemeId: customTheme!.id,
      editingThemeId: customTheme!.id,
      draftTheme: customTheme!,
    })

    useBroadcastStore.getState().deleteTheme(customTheme!.id)

    const state = useBroadcastStore.getState()
    expect(state.activeThemeId).toBe(firstTheme.id)
    expect(state.editingThemeId).toBeNull()
    expect(state.draftTheme).toBeNull()
  })
})
