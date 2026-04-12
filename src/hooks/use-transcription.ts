import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranscriptStore } from "@/stores"
import { useTauriEvent } from "./use-tauri-event"
import type { TranscriptSegment } from "@/types"

interface TranscriptPartialPayload {
  text: string
  is_final: boolean
  confidence: number
}

export function useTranscription() {
  const store = useTranscriptStore()

  // Listen for transcript events from Rust
  useTauriEvent<TranscriptPartialPayload>("transcript_partial", (payload) => {
    store.setPartial(payload.text)
  })

  useTauriEvent<TranscriptPartialPayload>("transcript_final", (payload) => {
    const segment: TranscriptSegment = {
      id: crypto.randomUUID(),
      text: payload.text,
      is_final: true,
      confidence: payload.confidence,
      words: [],
      timestamp: Date.now(),
    }
    store.addSegment(segment)
  })

  const startTranscription = useCallback(async () => {
    const { useSettingsStore } = await import("@/stores")
    const settings = useSettingsStore.getState()
    await invoke("start_transcription", {
      apiKey: settings.sttProvider === "deepgram" ? (settings.deepgramApiKey ?? "") : "",
      provider: settings.sttProvider,
    })
    store.setTranscribing(true)
  }, [store])

  const stopTranscription = useCallback(async () => {
    await invoke("stop_transcription")
    store.setTranscribing(false)
    store.setPartial("")
  }, [store])

  return {
    ...store,
    startTranscription,
    stopTranscription,
  }
}
