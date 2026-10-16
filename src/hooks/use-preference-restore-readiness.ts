import { useSyncExternalStore } from "react"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import { useOperatorMaintenanceStore } from "@/lib/operator-maintenance"
import { subscribeOutputChanges } from "@/lib/output-safety"
import { preferenceRestoreBlockedReason } from "@/lib/preference-restore-controller"

function subscribe(listener: () => void): () => void {
  const stops = [
    useBibleStore,
    useBroadcastStore,
    useTranscriptStore,
    useProfileStatusStore,
    useOperatorMaintenanceStore,
  ].map((store) => store.subscribe(listener))
  stops.push(subscribeOutputChanges(listener))
  return () => stops.forEach((stop) => stop())
}

export function usePreferenceRestoreReadiness(): string | null {
  return useSyncExternalStore(
    subscribe,
    preferenceRestoreBlockedReason,
    () => null
  )
}
