import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockLoad = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => mockLoad(...args),
}))

describe("tutorial store", () => {
  beforeEach(async () => {
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

  it("initial state has isRunning === false", async () => {
    const { useTutorialStore } = await import("./tutorial-store")
    expect(useTutorialStore.getState().isRunning).toBe(false)
  })

  it("startTutorial sets isRunning to true", async () => {
    const { useTutorialStore } = await import("./tutorial-store")
    useTutorialStore.getState().startTutorial()
    expect(useTutorialStore.getState().isRunning).toBe(true)
  })

  it("stopTutorial sets isRunning to false", async () => {
    const { useTutorialStore } = await import("./tutorial-store")
    useTutorialStore.getState().startTutorial()
    useTutorialStore.getState().stopTutorial()
    expect(useTutorialStore.getState().isRunning).toBe(false)
  })

  it("persistOnboardingComplete calls store.set and store.save", async () => {
    const { persistOnboardingComplete } = await import("./tutorial-store")
    await persistOnboardingComplete()
    expect(mockLoad).toHaveBeenCalledWith("settings.json", {
      autoSave: false,
    })
    expect(mockSet).toHaveBeenCalledWith("onboardingComplete", true)
    expect(mockSave).toHaveBeenCalled()
  })

  it("hydrateOnboardingState updates settings store when value is true", async () => {
    mockGet.mockResolvedValue(true)
    const { hydrateOnboardingState } = await import("./tutorial-store")
    const { useSettingsStore } = await import("./settings-store")

    await hydrateOnboardingState()

    expect(mockGet).toHaveBeenCalledWith("onboardingComplete")
    expect(useSettingsStore.getState().onboardingComplete).toBe(true)
  })

  it("hydrateOnboardingState leaves settings store unchanged when value is null", async () => {
    mockGet.mockResolvedValue(null)
    const { hydrateOnboardingState } = await import("./tutorial-store")
    const { useSettingsStore } = await import("./settings-store")

    await hydrateOnboardingState()

    expect(useSettingsStore.getState().onboardingComplete).toBe(false)
  })

  it("hydrateOnboardingState handles load rejection gracefully", async () => {
    mockLoad.mockRejectedValue(new Error("store not available"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { hydrateOnboardingState } = await import("./tutorial-store")

    await hydrateOnboardingState()

    expect(warnSpy).toHaveBeenCalledWith(
      "[tutorial] Failed to load persisted state, using defaults"
    )
    warnSpy.mockRestore()
  })

  it("persistOnboardingComplete handles save rejection gracefully", async () => {
    mockSave.mockRejectedValue(new Error("disk error"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { persistOnboardingComplete } = await import("./tutorial-store")

    await persistOnboardingComplete()

    expect(warnSpy).toHaveBeenCalledWith(
      "[tutorial] Failed to persist onboarding state"
    )
    warnSpy.mockRestore()
  })
})
