import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"
import { flushSettingsPersistence } from "@/stores/settings-store"
import {
  useBibleStore,
  flushBiblePersistence,
  hasPendingTranslationChange,
} from "@/stores/bible-store"
import {
  useBroadcastStore,
  flushBroadcastPersistence,
} from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useAudioStore } from "@/stores/audio-store"
import { hasPendingTranscriptionChange } from "@/hooks/use-transcription"
import { useProfileStatusStore } from "./profile-status"
import {
  beginOperatorMaintenance,
  isOperatorMaintenanceActive,
} from "./operator-maintenance"
import { hasPendingOutputChanges } from "./output-safety"
import { ensureSessionRevision, acceptSessionReset } from "./session-revision"
import { invalidatePresentation } from "./presentation-controller"
import {
  forgetBroadcastSession,
  writeBroadcastSession,
} from "./broadcast-session-snapshot"
import { captureSessionArchive, type SessionArchive } from "./session-archive"
import { useOperatorUiStore } from "./operator-ui"

const revision = z.number().int().nonnegative().safe()
const OutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("reset"), revision }),
  z.object({
    status: z.literal("rejected"),
    revision,
    message: z.string().min(1),
  }),
])
let recoveryArchive: SessionArchive | null = null
export class UncertainSessionResetError extends Error {
  constructor() {
    super(
      "The new-session reset could not be confirmed. Export the saved recovery snapshot, then reload Rhema and check surviving outputs."
    )
  }
}
export function getSessionResetRecoveryArchive(): SessionArchive | null {
  return recoveryArchive ? structuredClone(recoveryArchive) : null
}
function blockedReason(includeMaintenance: boolean): string | null {
  if (includeMaintenance && isOperatorMaintenanceActive())
    return "A session or preference change is already in progress."
  if (useProfileStatusStore.getState().readFailed)
    return "Restart Rhema to load saved preferences before starting a new session."
  const transcript = useTranscriptStore.getState()
  if (
    transcript.isTranscribing ||
    transcript.connectionStatus === "connecting" ||
    hasPendingTranscriptionChange()
  )
    return "Stop transcription and wait for it to finish before starting a new session."
  const audio = useAudioStore.getState()
  if (audio.isTesting || audio.isTestStarting || audio.isCapturing)
    return "Stop the audio test or capture before starting a new session."
  const broadcast = useBroadcastStore.getState()
  if (broadcast.isLive) return "Turn Live off before starting a new session."
  if (broadcast.isDesignerOpen)
    return "Close Theme Designer before starting a new session."
  if (broadcast.presentationRecovery !== "ready")
    return "Resolve output recovery before starting a new session."
  if (hasPendingOutputChanges()) return "Wait for the output change to finish."
  if (
    hasPendingTranslationChange() ||
    useBibleStore.getState().translationSelectionStatus === "loading"
  )
    return "Wait for the Bible translation change to finish."
  return null
}
export const newSessionBlockedReason = () => blockedReason(true)

/** The dialog reviews/exports first. Nothing is cleared until the exact native
 * acknowledgement; uncertain outcomes retain a detached pre-reset export. */
export async function startNewSession(): Promise<void> {
  const reason = newSessionBlockedReason()
  if (reason) throw new Error(reason)
  const lease = beginOperatorMaintenance()
  let snapshotInvalidated = false
  let nativeReset = false
  try {
    invalidatePresentation()
    useBibleStore.getState().setPendingNavigation(null)
    const flushes = await Promise.allSettled([
      flushSettingsPersistence(),
      flushBiblePersistence(),
      flushBroadcastPersistence(),
    ])
    const failed = flushes.find((result) => result.status === "rejected")
    if (failed?.status === "rejected") throw failed.reason
    const changed = blockedReason(false)
    if (changed) throw new Error(changed)
    const expected = await ensureSessionRevision()
    const lateChange = blockedReason(false)
    if (lateChange) throw new Error(lateChange)
    recoveryArchive = captureSessionArchive("Session before new-session reset")
    lease.commitPhase()
    forgetBroadcastSession()
    snapshotInvalidated = true
    let response: unknown
    try {
      response = await invoke("reset_operator_session", {
        expectedRevision: expected,
      })
    } catch {
      throw new UncertainSessionResetError()
    }
    const result = OutcomeSchema.safeParse(response)
    if (!result.success) throw new UncertainSessionResetError()
    if (result.data.status === "rejected") {
      if (result.data.revision !== expected)
        throw new UncertainSessionResetError()
      throw new Error(result.data.message)
    }
    if (result.data.revision !== expected + 1)
      throw new UncertainSessionResetError()
    nativeReset = true
    acceptSessionReset(expected, result.data.revision)
    useTranscriptStore.setState({
      segments: [],
      currentPartial: "",
      isTranscribing: false,
      connectionStatus: "disconnected",
    })
    useDetectionStore.getState().clearDetections()
    useQueueStore.getState().clearQueue()
    useBibleStore.setState({
      selectedVerse: null,
      pendingNavigation: null,
      searchResults: [],
      semanticResults: [],
      semanticResultSource: null,
      crossReferences: [],
      allowAutomaticPreview: false,
    })
    useAudioStore.setState({ level: { rms: 0, peak: 0 }, sourceLost: false })
    useBroadcastStore.setState({
      liveVerse: null,
      liveSourceVerse: null,
      liveTrace: null,
      isLive: false,
      clearMode: "background",
      hasExplicitClear: true,
    })
    useOperatorUiStore.setState((state) => ({
      sessionResetRevision: state.sessionResetRevision + 1,
      commandsOpen: false,
      shortcutsOpen: false,
    }))
    writeBroadcastSession(useBroadcastStore.getState())
    useBroadcastStore.getState().syncBroadcastOutput()
    recoveryArchive = null
  } catch (error) {
    if (nativeReset || error instanceof UncertainSessionResetError) {
      forgetBroadcastSession()
      const uncertain =
        error instanceof UncertainSessionResetError
          ? error
          : new UncertainSessionResetError()
      lease.recoveryRequired(uncertain.message)
      throw uncertain
    }
    recoveryArchive = null
    if (
      snapshotInvalidated &&
      useBroadcastStore.getState().presentationRecovery === "ready"
    )
      writeBroadcastSession(useBroadcastStore.getState())
    throw error
  } finally {
    lease.release()
  }
}
