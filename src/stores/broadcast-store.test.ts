import { beforeEach, describe, expect, it, vi } from "vitest"

const emitToMock = vi.fn()

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: emitToMock,
}))

const sampleLiveVerse = {
  reference: "John 3:16",
  segments: [{ text: "For God so loved the world", verseNumber: 16 }],
}

const ndiDefaults = {
  sourceName: "Rhema",
  resolution: "r1080p",
  frameRate: "fps24",
  alphaMode: "straightAlpha",
} as const

describe("broadcast store sync", () => {
  beforeEach(async () => {
    emitToMock.mockReset()
    emitToMock.mockResolvedValue(undefined)
    vi.resetModules()
  })

  it("syncBroadcastOutput emits current theme and verse to the main output window when live", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const theme = useBroadcastStore.getState().themes[0]
    useBroadcastStore.setState({
      isLive: true,
      liveVerse: sampleLiveVerse,
    })
    useBroadcastStore.getState().setActiveTheme(theme.id)

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({
        theme: expect.objectContaining({ id: theme.id }),
        verse: expect.objectContaining({ reference: "John 3:16" }),
      }),
    )
  })

  it("syncBroadcastOutput fans out to every output with its own theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    const [themeA, themeB] = state.themes
    state.setOutputTheme("main", themeA.id)
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: themeB.id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })
    state.addOutput({
      id: "out-c",
      name: "Lobby",
      type: "display",
      themeId: themeA.id,
      monitorIndex: 1,
      ndi: ndiDefaults,
    })
    useBroadcastStore.setState({ isLive: true, liveVerse: sampleLiveVerse })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(3)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeA.id }) }),
    )
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-b",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeB.id }) }),
    )
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-c",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ id: themeA.id }) }),
    )
  })

  it("removeOutput drops the output from the fan-out but never removes main", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: state.themes[0].id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })

    useBroadcastStore.getState().removeOutput("out-b")
    useBroadcastStore.getState().removeOutput("main")

    expect(useBroadcastStore.getState().outputs.map((o) => o.id)).toEqual(["main"])

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()
    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
      "broadcast:verse-update",
      expect.anything(),
    )
  })

  it("duplicateOutput copies config with fresh id, unique name and NDI source name", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    state.duplicateOutput("main")

    const outputs = useBroadcastStore.getState().outputs
    expect(outputs).toHaveLength(2)
    const copy = outputs[1]
    expect(copy.id).not.toBe("main")
    expect(copy.name).toBe("Main Display Copy")
    expect(copy.ndi.sourceName).not.toBe(outputs[0].ndi.sourceName)
  })

  it("emitDraftToBroadcast only reaches outputs using the edited theme", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const state = useBroadcastStore.getState()
    const [themeA, themeB] = state.themes
    state.setOutputTheme("main", themeA.id)
    state.addOutput({
      id: "out-b",
      name: "Stage",
      type: "ndi",
      themeId: themeB.id,
      monitorIndex: 0,
      ndi: ndiDefaults,
    })

    useBroadcastStore.getState().startEditing(themeB.id)
    emitToMock.mockClear()
    useBroadcastStore.getState().updateDraft({ name: "tweaked" })

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-out-b",
      "broadcast:verse-update",
      expect.objectContaining({ theme: expect.objectContaining({ name: "tweaked" }) }),
    )
  })

  it("setActiveTheme updates the main output and its mirror", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    const themeB = useBroadcastStore.getState().themes[1]

    useBroadcastStore.getState().setActiveTheme(themeB.id)

    const state = useBroadcastStore.getState()
    expect(state.activeThemeId).toBe(themeB.id)
    expect(state.outputs.find((o) => o.id === "main")?.themeId).toBe(themeB.id)
  })

  it("syncBroadcastOutput emits null verse when not live, even with a live verse set", async () => {
    const { useBroadcastStore } = await import("./broadcast-store")
    useBroadcastStore.setState({
      isLive: false,
      liveVerse: sampleLiveVerse,
    })

    emitToMock.mockClear()
    useBroadcastStore.getState().syncBroadcastOutput()

    expect(emitToMock).toHaveBeenCalledTimes(1)
    expect(emitToMock).toHaveBeenCalledWith(
      "broadcast-main",
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
      "broadcast-main",
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
      "broadcast-main",
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

describe("migrateLegacyOutputs", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("returns only the default main output when no legacy keys exist", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs(undefined, undefined)
    expect(outputs).toHaveLength(1)
    expect(outputs[0]).toMatchObject({ id: "main", type: "display", name: "Main Display" })
  })

  it("carries the legacy active theme onto the main output", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", undefined)
    expect(outputs).toHaveLength(1)
    expect(outputs[0].themeId).toBe("custom-theme-1")
  })

  it("creates an alt NDI output when the legacy alt theme differs from the default", async () => {
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", "custom-theme-2")
    expect(outputs).toHaveLength(2)
    expect(outputs[1]).toMatchObject({ id: "alt", type: "ndi", themeId: "custom-theme-2" })
  })

  it("skips the alt output when its legacy theme is still the builtin default", async () => {
    const { BUILTIN_THEMES } = await import("@/lib/builtin-themes")
    const { migrateLegacyOutputs } = await import("./broadcast-store")
    const outputs = migrateLegacyOutputs("custom-theme-1", BUILTIN_THEMES[0].id)
    expect(outputs).toHaveLength(1)
  })
})
