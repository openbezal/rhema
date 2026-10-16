// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  emit: vi.fn().mockResolvedValue(undefined),
  active: true,
  identity: "native-1",
  hasRenderer: true,
}))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) =>
    command === "get_broadcast_process_identity"
      ? mocks.identity
      : command === "get_ndi_output_ids"
        ? mocks.active
          ? ["main"]
          : []
        : { active: mocks.active }
  ),
}))
vi.mock("@tauri-apps/api/window", () => ({
  getAllWindows: vi.fn(async () =>
    mocks.active && mocks.hasRenderer
      ? [{ label: "broadcast-main", isVisible: async () => false }]
      : []
  ),
}))
vi.mock("@/lib/profile-persistence", () => ({
  isPublishingRestoredProfile: () => false,
  openProfileSection: async () => ({
    get: async () => undefined,
    set: vi.fn(),
    save: vi.fn(),
  }),
}))
beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
  mocks.emit.mockClear()
  mocks.active = true
  mocks.identity = "native-1"
  mocks.hasRenderer = true
})
const verse = {
  reference: "John 3:16 (KJV)",
  segments: [{ text: "Retained scripture", verseNumber: 16 }],
}
it("restores manual live content and reconciles a surviving sender without output-ready", async () => {
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const initial = await import("./broadcast-recovery")
  await initial.initializeBroadcastRecovery()
  useBroadcastStore.getState().setLiveVerse(null, null, "black")
  useBroadcastStore.getState().setAutoLive(false)
  useBroadcastStore.getState().setLiveVerse(verse)
  useBroadcastStore.getState().setLive(true)
  vi.resetModules()
  mocks.emit.mockClear()
  const reloaded = await import("@/stores/broadcast-store")
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  await reloaded.hydrateBroadcastThemes()
  await initializeBroadcastRecovery()
  expect(reloaded.useBroadcastStore.getState()).toMatchObject({
    isLive: true,
    liveVerse: verse,
    autoLive: false,
    presentationRecovery: "ready",
    outputStatus: { main: { ndiActive: true, previewOpen: false } },
  })
  expect(mocks.emit).toHaveBeenCalledWith(
    "broadcast-main",
    "broadcast:verse-update",
    expect.objectContaining({ verse })
  )
})
it("holds unknown surviving content after corrupt recovery until an explicit clear", async () => {
  sessionStorage.setItem("rhema.broadcast-session.v1", "corrupt")
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  await initializeBroadcastRecovery()
  expect(useBroadcastStore.getState().presentationRecovery).toBe("unknown")
  useBroadcastStore.getState().syncBroadcastOutput()
  useBroadcastStore.getState().setLive(true)
  useBroadcastStore.getState().setLiveVerse(verse)
  expect(mocks.emit).not.toHaveBeenCalled()
  expect(useBroadcastStore.getState().isLive).toBe(false)
  useBroadcastStore.getState().setLiveVerse(null, null, "transparent")
  expect(useBroadcastStore.getState()).toMatchObject({
    presentationRecovery: "ready",
    clearMode: "transparent",
    hasExplicitClear: true,
  })
  expect(mocks.emit).toHaveBeenCalledWith(
    "broadcast-main",
    "broadcast:verse-update",
    expect.objectContaining({ verse: null, clearMode: "transparent" })
  )
})
it.each(["transparent", "black", "background"] as const)(
  "retains explicit %s clear across reload and older preference hydration",
  async (clearMode) => {
    const { useBroadcastStore } = await import("@/stores/broadcast-store")
    useBroadcastStore.getState().setLiveVerse(null, null, clearMode)
    useBroadcastStore.getState().setAutoLive(false)
    vi.resetModules()
    const reloaded = await import("@/stores/broadcast-store")
    await reloaded.hydrateBroadcastThemes()
    expect(reloaded.useBroadcastStore.getState()).toMatchObject({
      clearMode,
      hasExplicitClear: true,
      autoLive: false,
      isLive: false,
    })
  }
)
it("starts a fresh webview session off air when there are no surviving outputs", async () => {
  mocks.active = false
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  await initializeBroadcastRecovery()
  expect(useBroadcastStore.getState()).toMatchObject({
    presentationRecovery: "ready",
    isLive: false,
    liveVerse: null,
  })
})
it("restores a newly configured output and its unpersisted theme before disk debounce", async () => {
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const state = useBroadcastStore.getState(),
    theme = { ...state.themes[0], id: "new-theme", name: "Unsaved disk theme" }
  state.saveTheme(theme)
  state.addOutput({
    ...state.outputs[0],
    id: "stage",
    themeId: theme.id,
    name: "Stage",
  })
  vi.resetModules()
  const reloaded = await import("@/stores/broadcast-store")
  await reloaded.hydrateBroadcastThemes()
  expect(
    reloaded.useBroadcastStore
      .getState()
      .outputs.find((output) => output.id === "stage")?.themeId
  ).toBe(theme.id)
  expect(
    reloaded.useBroadcastStore
      .getState()
      .themes.find((item) => item.id === theme.id)
  ).toEqual(theme)
})
it("never treats failed native inspection as proof of off air", async () => {
  const { invoke } = await import("@tauri-apps/api/core")
  vi.mocked(invoke).mockRejectedValueOnce(new Error("status unavailable"))
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  await initializeBroadcastRecovery()
  expect(useBroadcastStore.getState().presentationRecovery).toBe("unknown")
  expect(mocks.emit).not.toHaveBeenCalled()
})
it("drops stale recovery if a new session write exceeds storage quota", async () => {
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  useBroadcastStore.getState().setLiveVerse(verse)
  expect(sessionStorage.length).toBe(1)
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("quota")
    })
  useBroadcastStore.getState().setLiveVerse(null, null, "black")
  expect(sessionStorage.length).toBe(0)
  write.mockRestore()
})

it("does not restore on-air content from a previous native process", async () => {
  mocks.active = false
  const initial = await import("./broadcast-recovery")
  await initial.initializeBroadcastRecovery()
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  useBroadcastStore.getState().setLiveVerse(verse)
  useBroadcastStore.getState().setLive(true)
  vi.resetModules()
  mocks.identity = "native-2"
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  await initializeBroadcastRecovery()
  const reloaded = await import("@/stores/broadcast-store")
  expect(reloaded.useBroadcastStore.getState()).toMatchObject({
    presentationRecovery: "ready",
    isLive: false,
    liveVerse: null,
  })
})
it("holds an orphan sender and requires stopping it when no renderer can receive a clear", async () => {
  const initial = await import("./broadcast-recovery")
  await initial.initializeBroadcastRecovery()
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  useBroadcastStore.getState().setLiveVerse(null, null, "black")
  useBroadcastStore.getState().setLiveVerse(verse)
  useBroadcastStore.getState().setLive(true)
  vi.resetModules()
  mocks.hasRenderer = false
  mocks.emit.mockClear()
  const reloaded = await import("@/stores/broadcast-store")
  const { initializeBroadcastRecovery } = await import("./broadcast-recovery")
  await initializeBroadcastRecovery()
  expect(reloaded.useBroadcastStore.getState().presentationRecovery).toBe(
    "unknown"
  )
  reloaded.useBroadcastStore.getState().setLiveVerse(null, null, "transparent")
  expect(mocks.emit).not.toHaveBeenCalled()
  expect(reloaded.useBroadcastStore.getState().presentationRecovery).toBe(
    "unknown"
  )
})
