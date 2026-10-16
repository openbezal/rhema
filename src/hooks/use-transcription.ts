import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { ensureSessionRevision } from "@/lib/session-revision"
import { useSettingsStore } from "@/stores/settings-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import {
  isOperatorMaintenanceActive,
  isOperatorWorkCurrent,
  operatorRevision,
} from "@/lib/operator-maintenance"

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
let actionRevision = 0
let starting: Promise<void> | null = null
let stopping: Promise<void> | null = null
export const hasPendingTranscriptionChange = () =>
  starting !== null || stopping !== null

export const transcriptionActions = {
  start(onMissingApiKey?: () => void): Promise<void> {
    const transcript = useTranscriptStore.getState()
    if (isOperatorMaintenanceActive() || stopping || transcript.isTranscribing)
      return Promise.resolve()
    if (starting) return starting
    const revision = ++actionRevision
    const epoch = operatorRevision()
    const current = () =>
      actionRevision === revision && isOperatorWorkCurrent(epoch)
    transcript.setConnectionStatus("connecting")
    const job = (async () => {
      try {
        const expectedSessionRevision = await ensureSessionRevision()
        if (!current()) return
        const startRevision = await invoke<number>(
          "read_transcription_start_revision"
        )
        if (!current()) return
        if (!Number.isSafeInteger(startRevision) || startRevision < 0)
          throw new Error("Invalid transcription session revision")
        const settings = useSettingsStore.getState()
        await invoke("start_transcription", {
          startRevision,
          expectedSessionRevision,
          apiKey:
            settings.sttProvider === "deepgram"
              ? (settings.deepgramApiKey ?? "")
              : "",
          deviceId: settings.audioDeviceId,
          gain: settings.gain,
          provider: settings.sttProvider,
        })
        if (current()) transcript.setTranscribing(true)
      } catch (error) {
        if (!current()) return
        const message = String(error)
        transcript.setConnectionStatus("error")
        if (message.includes(MISSING_DEEPGRAM_KEY_MARKER) && onMissingApiKey)
          onMissingApiKey()
        else
          toast.error("Could not start transcription", { description: message })
      }
    })()
    starting = job
    void job.then(() => {
      if (starting === job) starting = null
    })
    return job
  },

  stop(): Promise<void> {
    if (stopping) return stopping
    const revision = ++actionRevision
    const epoch = operatorRevision()
    starting = null
    const transcript = useTranscriptStore.getState()
    const current = () =>
      actionRevision === revision && operatorRevision() === epoch
    const job = (async () => {
      try {
        await invoke("stop_transcription")
      } catch (error) {
        if (current() && String(error) !== NOT_RUNNING_ERROR)
          toast.error("Could not stop transcription", {
            description: String(error),
          })
      }
      if (!current()) return
      transcript.setTranscribing(false)
      transcript.setPartial("")
      transcript.setConnectionStatus("disconnected")
    })()
    stopping = job
    void job.then(() => {
      if (stopping === job) stopping = null
    })
    return job
  },
}

export function useTranscription(options?: UseTranscriptionOptions) {
  const segments = useTranscriptStore((s) => s.segments)
  const isTranscribing = useTranscriptStore((s) => s.isTranscribing)
  const connectionStatus = useTranscriptStore((s) => s.connectionStatus)

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
