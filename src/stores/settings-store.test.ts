import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockLoad = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => mockLoad(...args),
}))

async function flushSave(): Promise<void> {
  // Advance past the debounce window, then let the chained
  // pendingSave promise resolve.
  await vi.advanceTimersByTimeAsync(300)
  await Promise.resolve()
  await Promise.resolve()
}

describe("settings store", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    mockGet.mockReset()
    mockSet.mockReset()
    mockSave.mockReset()
    mockLoad.mockReset()
    mockLoad.mockResolvedValue({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    })
    vi.resetModules()
  })

  it("hydrate merges persisted values over defaults", async () => {
    mockGet.mockImplementation(async (key: string) => {
      if (key === "gain") return 2.5
      if (key === "sttProvider") return "whisper"
      if (key === "deepgramApiKey") return "dg-key"
      return null
    })

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    const state = useSettingsStore.getState()
    expect(state.gain).toBe(2.5)
    expect(state.sttProvider).toBe("whisper")
    expect(state.deepgramApiKey).toBe("dg-key")
    // Defaults remain for keys with null
    expect(state.autoMode).toBe(false)
    expect(state.confidenceThreshold).toBe(0.8)
  })

  it("hydrate with no persisted values falls back to defaults", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    const before = useSettingsStore.getState()
    await hydrateSettings()
    const after = useSettingsStore.getState()

    expect(after.gain).toBe(before.gain)
    expect(after.sttProvider).toBe(before.sttProvider)
    expect(after.autoMode).toBe(before.autoMode)
  })

  it("a setter call after hydration writes the full snapshot to disk", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setGain(1.75)

    // Debounced — nothing written yet.
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockSave).not.toHaveBeenCalled()

    await flushSave()

    expect(mockSet).toHaveBeenCalledWith("gain", 1.75)
    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it("rapid setter calls coalesce into a single save", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    const { setGain } = useSettingsStore.getState()
    setGain(1.1)
    setGain(1.2)
    setGain(1.3)

    await flushSave()

    expect(mockSave).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith("gain", 1.3)
  })

  it("concurrent hydrate calls attach only one subscription", async () => {
    mockGet.mockResolvedValue(null)

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    // Kick off two concurrent hydrations — a second caller must not
    // attach a duplicate subscription that would double every write.
    await Promise.all([hydrateSettings(), hydrateSettings()])

    useSettingsStore.getState().setGain(1.5)
    await flushSave()

    expect(mockSave).toHaveBeenCalledTimes(1)
  })

  it("hydrate handles load rejection gracefully", async () => {
    mockLoad.mockRejectedValue(new Error("store not available"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await expect(hydrateSettings()).resolves.toBeUndefined()

    // Defaults preserved
    expect(useSettingsStore.getState().gain).toBe(1.0)
    expect(warnSpy).toHaveBeenCalledWith(
      "[settings] Failed to load persisted state, using defaults"
    )
    warnSpy.mockRestore()
  })

  it("persist handles save rejection gracefully", async () => {
    mockGet.mockResolvedValue(null)
    mockSave.mockRejectedValue(new Error("disk error"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { hydrateSettings, useSettingsStore } = await import("./settings-store")
    await hydrateSettings()

    useSettingsStore.getState().setAutoMode(true)
    await flushSave()

    expect(warnSpy).toHaveBeenCalledWith("[settings] Failed to persist settings")
    warnSpy.mockRestore()
  })
})
