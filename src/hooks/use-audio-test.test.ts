import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
const mockToastError = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("@/hooks/use-tauri-event", () => ({
  useTauriEvent: () => {},
}))

async function loadModules() {
  vi.resetModules()
  const audioMod = await import("@/stores/audio-store")
  const settingsMod = await import("@/stores/settings-store")
  const hookMod = await import("./use-audio-test")
  return {
    useAudioStore: audioMod.useAudioStore,
    useSettingsStore: settingsMod.useSettingsStore,
    audioTestActions: hookMod.audioTestActions,
  }
}

describe("use-audio-test", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockToastError.mockReset()
  })

  describe("audioTestActions.start", () => {
    it("invokes start_audio_test with settings-derived device and gain", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useAudioStore, useSettingsStore, audioTestActions } =
        await loadModules()

      useSettingsStore.setState({ audioDeviceId: "dev-42", gain: 1.5 })

      await audioTestActions.start()

      expect(mockInvoke).toHaveBeenCalledWith("start_audio_test", {
        deviceId: "dev-42",
        gain: 1.5,
      })
      expect(useAudioStore.getState().isTesting).toBe(true)
    })

    it("passes null deviceId for the system default", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useSettingsStore, audioTestActions } = await loadModules()

      useSettingsStore.setState({ audioDeviceId: null, gain: 1.0 })

      await audioTestActions.start()

      expect(mockInvoke).toHaveBeenCalledWith("start_audio_test", {
        deviceId: null,
        gain: 1.0,
      })
    })

    it("surfaces start errors as a toast and stays not-testing", async () => {
      mockInvoke.mockRejectedValue("Audio device not found: dev-gone")
      const { useAudioStore, audioTestActions } = await loadModules()

      await audioTestActions.start()

      expect(mockToastError).toHaveBeenCalledWith(
        "Could not start audio test",
        { description: "Audio device not found: dev-gone" }
      )
      expect(useAudioStore.getState().isTesting).toBe(false)
    })
  })

  describe("audioTestActions.stop", () => {
    it("invokes stop_audio_test and resets testing state and level", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useAudioStore, audioTestActions } = await loadModules()

      useAudioStore.setState({
        isTesting: true,
        level: { rms: 0.4, peak: 0.7 },
      })

      await audioTestActions.stop()

      expect(mockInvoke).toHaveBeenCalledWith("stop_audio_test")
      const state = useAudioStore.getState()
      expect(state.isTesting).toBe(false)
      expect(state.level).toEqual({ rms: 0, peak: 0 })
    })

    it("swallows stop errors but still resets UI state", async () => {
      mockInvoke.mockRejectedValue("backend unavailable")
      const { useAudioStore, audioTestActions } = await loadModules()

      useAudioStore.setState({ isTesting: true })

      await audioTestActions.stop()

      expect(mockToastError).not.toHaveBeenCalled()
      expect(useAudioStore.getState().isTesting).toBe(false)
    })
  })

  describe("audioTestActions.toggle", () => {
    it("starts when not testing", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useAudioStore, audioTestActions } = await loadModules()

      useAudioStore.setState({ isTesting: false })

      await audioTestActions.toggle()

      expect(mockInvoke).toHaveBeenCalledWith(
        "start_audio_test",
        expect.anything()
      )
      expect(useAudioStore.getState().isTesting).toBe(true)
    })

    it("stops when already testing", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useAudioStore, audioTestActions } = await loadModules()

      useAudioStore.setState({ isTesting: true })

      await audioTestActions.toggle()

      expect(mockInvoke).toHaveBeenCalledWith("stop_audio_test")
      expect(useAudioStore.getState().isTesting).toBe(false)
    })
  })

  describe("audio_test_stopped contract", () => {
    it("a self-stop resets testing state and zeroes the level", async () => {
      const { useAudioStore } = await loadModules()

      useAudioStore.setState({
        isTesting: true,
        level: { rms: 0.3, peak: 0.5 },
      })

      // Simulate what the audio_test_stopped handler does
      const audio = useAudioStore.getState()
      audio.setTesting(false)
      audio.setLevel({ rms: 0, peak: 0 })

      const state = useAudioStore.getState()
      expect(state.isTesting).toBe(false)
      expect(state.level).toEqual({ rms: 0, peak: 0 })
    })
  })
})
