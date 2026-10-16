import { useSyncExternalStore } from "react"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useAudioStore } from "@/stores/audio-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import { useOperatorMaintenanceStore } from "@/lib/operator-maintenance"
import { subscribeOutputChanges } from "@/lib/output-safety"
import { newSessionBlockedReason } from "@/lib/session-reset-controller"
import { subscribeTranscriptionChanges } from "./use-transcription"
function subscribe(listener: () => void): () => void {
  const stops = [
    useBibleStore,
    useBroadcastStore,
    useTranscriptStore,
    useAudioStore,
    useProfileStatusStore,
    useOperatorMaintenanceStore,
  ].map((store) => store.subscribe(listener))
  stops.push(subscribeOutputChanges(listener))
  stops.push(subscribeTranscriptionChanges(listener))
  return () => stops.forEach((stop) => stop())
}
export function useNewSessionReadiness(): string | null {
  return useSyncExternalStore(subscribe, newSessionBlockedReason, () => null)
}
