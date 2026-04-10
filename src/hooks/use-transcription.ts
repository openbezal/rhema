import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useTranscriptStore, useSettingsStore } from "@/stores"
import { useTauriEvent } from "./use-tauri-event"
import type { TranscriptSegment } from "@/types"

interface TranscriptPartialPayload {
  text: string
  is_final: boolean
  confidence: number
}

export function useTranscription() {
  const store = useTranscriptStore()
  const transcriptionBackend = useSettingsStore((s) => s.transcriptionBackend)
  const deepgramApiKey = useSettingsStore((s) => s.deepgramApiKey)
  const audioDeviceId = useSettingsStore((s) => s.audioDeviceId)
  const gain = useSettingsStore((s) => s.gain)

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
    await invoke("start_transcription", {
      apiKey: deepgramApiKey ?? "",
      deviceId: audioDeviceId,
      gain,
      backend: transcriptionBackend,
    })
    store.setTranscribing(true)
  }, [audioDeviceId, deepgramApiKey, gain, store, transcriptionBackend])

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
