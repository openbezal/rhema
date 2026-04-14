import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useSettingsStore } from "@/stores/settings-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useTauriEvent } from "./use-tauri-event"

interface TranscriptPartialPayload {
  text: string
  is_final: boolean
  confidence: number
}

interface UseTranscriptionOptions {
  /**
   * Called when `start_transcription` fails because the user picked the
   * Deepgram provider but hasn't set an API key. Panels typically react by
   * opening a key-prompt dialog instead of showing the default toast.
   */
  onMissingApiKey?: () => void
}

const MISSING_DEEPGRAM_KEY_MARKER = "No Deepgram API key"
const NOT_RUNNING_ERROR = "Transcription is not running"

export const transcriptionActions = {
  async start(onMissingApiKey?: () => void): Promise<void> {
    const transcript = useTranscriptStore.getState()
    transcript.setConnectionStatus("connecting")

    const settings = useSettingsStore.getState()
    try {
      await invoke("start_transcription", {
        apiKey:
          settings.sttProvider === "deepgram"
            ? (settings.deepgramApiKey ?? "")
            : "",
        deviceId: settings.audioDeviceId,
        gain: settings.gain,
        provider: settings.sttProvider,
      })
      transcript.setTranscribing(true)
    } catch (e) {
      const msg = String(e)
      transcript.setConnectionStatus("error")
      if (msg.includes(MISSING_DEEPGRAM_KEY_MARKER) && onMissingApiKey) {
        onMissingApiKey()
      } else {
        toast.error("Could not start transcription", { description: msg })
      }
    }
  },

  async stop(): Promise<void> {
    const transcript = useTranscriptStore.getState()
    try {
      await invoke("stop_transcription")
    } catch (e) {
      if (String(e) !== NOT_RUNNING_ERROR) {
        toast.error("Could not stop transcription", { description: String(e) })
      }
    }
    transcript.setTranscribing(false)
    transcript.setPartial("")
    transcript.setConnectionStatus("disconnected")
  },
}

export function useTranscription(options?: UseTranscriptionOptions) {
  const segments = useTranscriptStore((s) => s.segments)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const connectionStatus = useTranscriptStore((s) => s.connectionStatus)

  // STT lifecycle events
  useTauriEvent("stt_connected", () => {
    useTranscriptStore.getState().setConnectionStatus("connected")
  })
  useTauriEvent("stt_disconnected", () => {
    useTranscriptStore.getState().setConnectionStatus("disconnected")
  })
  useTauriEvent<string>("stt_error", (msg) => {
    useTranscriptStore.getState().setConnectionStatus("error")
    toast.error("Transcription error", { description: msg })
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_partial", (payload) => {
    useTranscriptStore.getState().setPartial(payload.text)
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_final", (payload) => {
    useTranscriptStore.getState().addSegment({
      id: crypto.randomUUID(),
      text: payload.text,
      is_final: true,
      confidence: payload.confidence,
      words: [],
      timestamp: Date.now(),
    })
  })

  const onMissingApiKey = options?.onMissingApiKey

  const startTranscription = useCallback(
    () => transcriptionActions.start(onMissingApiKey),
    [onMissingApiKey]
  )

  return {
    segments,
    isTranscribing,
    connectionStatus,
    startTranscription,
    stopTranscription: transcriptionActions.stop,
  }
}
