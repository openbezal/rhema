import { create } from "zustand"

type Phase = "idle" | "preparing" | "committing" | "recovery"
export const useOperatorMaintenanceStore = create<{
  phase: Phase
  revision: number
  message: string | null
}>(() => ({ phase: "idle", revision: 0, message: null }))

export const operatorRevision = () =>
  useOperatorMaintenanceStore.getState().revision
export const isOperatorMaintenanceActive = () =>
  useOperatorMaintenanceStore.getState().phase !== "idle"
export const isOperatorWorkCurrent = (revision: number) =>
  !isOperatorMaintenanceActive() && operatorRevision() === revision

/** Acquired before awaiting anything; all app consumers see the boundary now. */
export function beginOperatorMaintenance() {
  if (isOperatorMaintenanceActive())
    throw new Error("Preference maintenance is already active")
  const revision = operatorRevision() + 1
  useOperatorMaintenanceStore.setState({
    phase: "preparing",
    revision,
    message: null,
  })
  let released = false
  const owns = () =>
    !released &&
    operatorRevision() === revision &&
    isOperatorMaintenanceActive()
  return {
    commitPhase() {
      if (
        owns() &&
        useOperatorMaintenanceStore.getState().phase === "preparing"
      )
        useOperatorMaintenanceStore.setState({ phase: "committing" })
    },
    recoveryRequired(message: string) {
      if (owns())
        useOperatorMaintenanceStore.setState({ phase: "recovery", message })
    },
    release() {
      if (
        !owns() ||
        useOperatorMaintenanceStore.getState().phase === "recovery"
      )
        return
      released = true
      useOperatorMaintenanceStore.setState({ phase: "idle", message: null })
    },
  }
}

/** Cleanup cancels old async closures before native maintenance can start. */
export function connectOutsideMaintenance(
  connect: () => () => void
): () => void {
  let stop: (() => void) | null = null
  const disconnect = () => {
    const previous = stop
    stop = null
    previous?.()
  }
  const reconcile = () => {
    if (isOperatorMaintenanceActive()) disconnect()
    else if (!stop) stop = connect()
  }
  const unsubscribe = useOperatorMaintenanceStore.subscribe(reconcile)
  reconcile()
  return () => {
    unsubscribe()
    disconnect()
  }
}
