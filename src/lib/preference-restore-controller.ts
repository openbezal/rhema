import {
  useSettingsStore,
  flushSettingsPersistence,
} from "@/stores/settings-store"
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
import { useDetectionStore } from "@/stores/detection-store"
import { useProfileStatusStore } from "./profile-status"
import {
  beginOperatorMaintenance,
  isOperatorMaintenanceActive,
} from "./operator-maintenance"
import { hasPendingOutputChanges } from "./output-safety"
import { invalidatePresentation } from "./presentation-controller"
import {
  restoreProfileAtomically,
  UncertainProfileCommitError,
  type ProfileApplyReceipt,
} from "./profile-persistence"
import {
  resolvePreferencesRestore,
  type StagedPreferencesRestore,
} from "./preference-restore"
import { translationCode } from "./translation-selection"
import {
  forgetBroadcastSession,
  writeBroadcastSession,
} from "./broadcast-session-snapshot"

function blockedReason(includeMaintenance: boolean): string | null {
  if (includeMaintenance && isOperatorMaintenanceActive())
    return "A preference change is already in progress."
  if (useProfileStatusStore.getState().readFailed)
    return "Restart Rhema to load your saved preferences before restoring."
  const transcript = useTranscriptStore.getState()
  if (transcript.isTranscribing || transcript.connectionStatus === "connecting")
    return "Stop transcription before restoring preferences."
  const broadcast = useBroadcastStore.getState()
  if (broadcast.isLive) return "Turn Live off before restoring preferences."
  if (broadcast.isDesignerOpen)
    return "Close Theme Designer before restoring preferences."
  if (hasPendingOutputChanges())
    return "Wait for the output change to finish before restoring preferences."
  if (
    hasPendingTranslationChange() ||
    useBibleStore.getState().translationSelectionStatus === "loading"
  )
    return "Wait for the Bible translation change to finish."
  return null
}

export const preferenceRestoreBlockedReason = () => blockedReason(true)

/** Read-only staging precedes this action. All fallible native work finishes
 * before any imported values are published to active stores. */
export async function applyPreferencesRestore(
  stage: StagedPreferencesRestore,
  primaryCode: string | null,
  secondaryCode: string | null | undefined
): Promise<void> {
  const reason = preferenceRestoreBlockedReason()
  if (reason) throw new Error(reason)
  const initial = resolvePreferencesRestore(
    stage,
    primaryCode,
    secondaryCode,
    useBibleStore.getState().translations
  )
  const lease = beginOperatorMaintenance()
  let snapshotInvalidated = false
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
    const preferences = resolvePreferencesRestore(
      { ...stage, preferences: initial },
      primaryCode,
      secondaryCode,
      useBibleStore.getState().translations
    )
    lease.commitPhase()
    // A reload can interrupt JavaScript before it sees the acknowledgement.
    // Canonical preferences must win during that interval as well.
    forgetBroadcastSession()
    snapshotInvalidated = true
    await restoreProfileAtomically(
      preferences,
      (receipt: ProfileApplyReceipt) => {
        const bible = useBibleStore.getState()
        const matching = bible.translations.filter(
          (item) =>
            item.is_downloaded &&
            item.id === receipt.primary_translation_id &&
            translationCode(item) === receipt.primary_translation_code
        )
        if (matching.length !== 1) throw new UncertainProfileCommitError()
        useSettingsStore.setState({ ...preferences.settings })
        useBibleStore.setState({
          activeTranslationId: receipt.primary_translation_id,
          activeTranslationCode: receipt.primary_translation_code,
          secondaryTranslationCode: receipt.secondary_translation_code,
          translationSelectionStatus: "ready",
          followDetections: preferences.followDetections,
          followRevision: bible.followRevision + 1,
          pendingNavigation: null,
          books: [],
          currentChapter: [],
          searchResults: [],
          semanticResults: [],
          crossReferences: [],
        })
        useBroadcastStore.setState((state) => ({
          themes: [...state.themes, ...preferences.customThemes],
          autoLive: preferences.autoLive,
        }))
        useDetectionStore.getState().pruneSuggestions()
      }
    )
  } catch (error) {
    if (error instanceof UncertainProfileCommitError) {
      // An older webview snapshot must not override the canonical preferences
      // on the required reload. Keep the current in-memory frame until then;
      // native output reconciliation will require verification after reload.
      forgetBroadcastSession()
      lease.recoveryRequired(error.message)
    } else if (
      snapshotInvalidated &&
      useBroadcastStore.getState().presentationRecovery === "ready"
    ) {
      writeBroadcastSession(useBroadcastStore.getState())
    }
    throw error
  } finally {
    lease.release()
  }
}
