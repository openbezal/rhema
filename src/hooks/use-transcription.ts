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

export function useTranscription() {
  const segments = useTranscriptStore((s) => s.segments)
  const currentPartial = useTranscriptStore((s) => s.currentPartial)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const connectionStatus = useTranscriptStore((s) => s.connectionStatus)

  const setPartial = useTranscriptStore((s) => s.setPartial)
  const addSegment = useTranscriptStore((s) => s.addSegment)
  const setTranscribing = useTranscriptStore((s) => s.setTranscribing)

  useTauriEvent<TranscriptPartialPayload>("transcript_partial", (payload) => {
    setPartial(payload.text)
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_final", (payload) => {
    addSegment({
      id: crypto.randomUUID(),
      text: payload.text,
      is_final: true,
      confidence: payload.confidence,
      words: [],
      timestamp: Date.now(),
    })
  })

  const startTranscription = useCallback(async () => {
    const settings = useSettingsStore.getState()
    try {
      await invoke("start_transcription", {
        apiKey: settings.sttProvider === "deepgram" ? (settings.deepgramApiKey ?? "") : "",
        provider: settings.sttProvider,
      })
      setTranscribing(true)
    } catch (e) {
      toast.error("Could not start transcription", { description: String(e) })
    }
  }, [setTranscribing])

  const stopTranscription = useCallback(async () => {
    try {
      await invoke("stop_transcription")
    } catch (e) {
      // Expected when backend state is already clean (e.g. after a webview
      // reload reset). Must match stop_transcription in src-tauri/src/commands/stt.rs exactly.
      if (String(e) !== "Transcription is not running") {
        toast.error("Could not stop transcription", { description: String(e) })
      }
    }
    setTranscribing(false)
    setPartial("")
  }, [setTranscribing, setPartial])

  return {
    segments,
    currentPartial,
    isTranscribing,
    connectionStatus,
    startTranscription,
    stopTranscription,
  }
}
