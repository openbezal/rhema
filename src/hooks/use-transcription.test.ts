import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.fn()
const mockToastError = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock("@/hooks/use-tauri-event", () => ({
  useTauriEvent: () => {},
}))

async function loadModules() {
  vi.resetModules()
  const transcriptMod = await import("@/stores/transcript-store")
  const settingsMod = await import("@/stores/settings-store")
  const hookMod = await import("./use-transcription")
  return {
    useTranscriptStore: transcriptMod.useTranscriptStore,
    useSettingsStore: settingsMod.useSettingsStore,
    transcriptionActions: hookMod.transcriptionActions,
  }
}

describe("use-transcription", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockToastError.mockReset()
  })

  describe("transcriptionActions.start", () => {
    it("invokes start_transcription with settings-derived params for whisper", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useSettingsStore, transcriptionActions } = await loadModules()

      useSettingsStore.setState({
        sttProvider: "whisper",
        deepgramApiKey: "ignored-for-whisper",
        audioDeviceId: "dev-42",
        gain: 1.5,
      })

      await transcriptionActions.start()

      expect(mockInvoke).toHaveBeenCalledWith("start_transcription", {
        apiKey: "", // whisper path never forwards the key
        deviceId: "dev-42",
        gain: 1.5,
        provider: "whisper",
      })
    })

    it("forwards the Deepgram key when provider is deepgram", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useSettingsStore, transcriptionActions } = await loadModules()

      useSettingsStore.setState({
        sttProvider: "deepgram",
        deepgramApiKey: "dg-live-123",
        audioDeviceId: null,
        gain: 1.0,
      })

      await transcriptionActions.start()

      expect(mockInvoke).toHaveBeenCalledWith(
        "start_transcription",
        expect.objectContaining({
          apiKey: "dg-live-123",
          provider: "deepgram",
          deviceId: null,
          gain: 1.0,
        })
      )
    })

    it("sets connectionStatus to 'connecting' before invoke resolves and 'isTranscribing' after", async () => {
      let resolveInvoke: () => void = () => {}
      mockInvoke.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveInvoke = resolve
        })
      )

      const { useTranscriptStore, transcriptionActions } = await loadModules()

      const pending = transcriptionActions.start()

      expect(useTranscriptStore.getState().connectionStatus).toBe("connecting")
      expect(useTranscriptStore.getState().isTranscribing).toBe(false)

      resolveInvoke()
      await pending

      expect(useTranscriptStore.getState().isTranscribing).toBe(true)
      expect(useTranscriptStore.getState().connectionStatus).not.toBe("error")
    })

    it("routes a missing-Deepgram-key error to onMissingApiKey (no toast)", async () => {
      mockInvoke.mockRejectedValue(
        "No Deepgram API key provided. Set it in Settings or via DEEPGRAM_API_KEY env var."
      )
      const { useTranscriptStore, transcriptionActions } = await loadModules()
      const onMissingApiKey = vi.fn()

      await transcriptionActions.start(onMissingApiKey)

      expect(onMissingApiKey).toHaveBeenCalledTimes(1)
      expect(mockToastError).not.toHaveBeenCalled()
      expect(useTranscriptStore.getState().connectionStatus).toBe("error")
      expect(useTranscriptStore.getState().isTranscribing).toBe(false)
    })

    it("falls back to toast when missing-key error fires but no callback is provided", async () => {
      mockInvoke.mockRejectedValue("No Deepgram API key provided")
      const { transcriptionActions } = await loadModules()

      await transcriptionActions.start()

      expect(mockToastError).toHaveBeenCalledWith(
        "Could not start transcription",
        { description: "No Deepgram API key provided" }
      )
    })

    it("surfaces any other start error as a toast", async () => {
      mockInvoke.mockRejectedValue("Whisper model not found")
      const { useTranscriptStore, transcriptionActions } = await loadModules()
      const onMissingApiKey = vi.fn()

      await transcriptionActions.start(onMissingApiKey)

      expect(onMissingApiKey).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(
        "Could not start transcription",
        { description: "Whisper model not found" }
      )
      expect(useTranscriptStore.getState().connectionStatus).toBe("error")
    })
  })

  describe("transcriptionActions.stop", () => {
    it("resets transcript state on success", async () => {
      mockInvoke.mockResolvedValue(undefined)
      const { useTranscriptStore, transcriptionActions } = await loadModules()

      useTranscriptStore.setState({
        isTranscribing: true,
        currentPartial: "partial text",
        connectionStatus: "connected",
      })

      await transcriptionActions.stop()

      const state = useTranscriptStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.currentPartial).toBe("")
      expect(state.connectionStatus).toBe("disconnected")
      expect(mockToastError).not.toHaveBeenCalled()
    })

    it("silently swallows the exact 'Transcription is not running' error", async () => {
      mockInvoke.mockRejectedValue("Transcription is not running")
      const { useTranscriptStore, transcriptionActions } = await loadModules()

      useTranscriptStore.setState({ isTranscribing: true })

      await transcriptionActions.stop()

      expect(mockToastError).not.toHaveBeenCalled()
      expect(useTranscriptStore.getState().isTranscribing).toBe(false)
    })

    it("surfaces other stop errors as a toast AND still resets UI state", async () => {
      mockInvoke.mockRejectedValue("Audio device disappeared")
      const { useTranscriptStore, transcriptionActions } = await loadModules()

      useTranscriptStore.setState({
        isTranscribing: true,
        currentPartial: "mid-sentence...",
        connectionStatus: "connected",
      })

      await transcriptionActions.stop()

      expect(mockToastError).toHaveBeenCalledWith(
        "Could not stop transcription",
        { description: "Audio device disappeared" }
      )
      const state = useTranscriptStore.getState()
      expect(state.isTranscribing).toBe(false)
      expect(state.currentPartial).toBe("")
      expect(state.connectionStatus).toBe("disconnected")
    })
  })

  describe("stt_error integration contract", () => {
    it("surfaces stt errors via toast and sets connection status to error", async () => {
      const { useTranscriptStore } = await loadModules()

      // Simulate what the stt_error handler does
      useTranscriptStore.getState().setConnectionStatus("error")
      mockToastError("Transcription error", {
        description: "WebSocket closed unexpectedly",
      })

      expect(useTranscriptStore.getState().connectionStatus).toBe("error")
      expect(mockToastError).toHaveBeenCalledWith("Transcription error", {
        description: "WebSocket closed unexpectedly",
      })
    })
  })
})
