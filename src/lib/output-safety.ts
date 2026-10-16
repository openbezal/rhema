import { ask } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { MAIN_OUTPUT_ID, type BroadcastOutput } from "@/types"
import { isOperatorMaintenanceActive, isOperatorWorkCurrent, operatorRevision } from "./operator-maintenance"
import { disableOutput, enableOutput, inspectOutput, outputRuntimeVersion, transportChanged } from "./broadcast-output-control"

let liveRevision = 0
let pendingLive: Promise<boolean> | null = null
let pendingLiveEpoch = -1
const outputJobs = new Map<string, Promise<boolean>>()
const outputObservers = new Set<() => void>()
export function subscribeOutputChanges(listener: () => void): () => void {
  outputObservers.add(listener)
  return () => { outputObservers.delete(listener) }
}
const notifyOutputChanges = () => outputObservers.forEach(listener => listener())
const currentOutput = (id: string) => useBroadcastStore.getState().outputs.find(item => item.id === id)

/** All control surfaces share the same latest operator intent and no-output warning. */
export function requestOnAir(active: boolean): Promise<boolean> {
  if (isOperatorMaintenanceActive() || useBroadcastStore.getState().presentationRecovery !== "ready") return Promise.resolve(false)
  const epoch = operatorRevision()
  if (!active) {
    liveRevision++
    pendingLive = null
    pendingLiveEpoch = -1
    useBroadcastStore.getState().setLive(false)
    return Promise.resolve(true)
  }
  if (useBroadcastStore.getState().isLive) return Promise.resolve(true)
  if (pendingLive && pendingLiveEpoch === epoch) return pendingLive
  const revision = ++liveRevision
  const job = (async () => {
    const outputs = useBroadcastStore.getState().outputs
    const versions = outputs.map(output => outputRuntimeVersion(output.id))
    const unchanged = () => isOperatorWorkCurrent(epoch) && useBroadcastStore.getState().outputs.length === outputs.length &&
      outputs.every((output, index) => currentOutput(output.id) === output && outputRuntimeVersion(output.id) === versions[index])
    const states = await Promise.all(outputs.map(inspectOutput))
    if (revision !== liveRevision || !unchanged()) return false
    const audience = states.some(({ status }) => status.previewOpen || status.ndiActive)
    if (!audience && !await ask("No visible display or active NDI feed is available. Go live anyway?", {
      title: "No broadcast output", kind: "warning", okLabel: "Go live anyway", cancelLabel: "Stay off air",
    })) return false
    if (revision !== liveRevision || !unchanged()) return false
    useBroadcastStore.getState().setLive(true)
    return true
  })().catch(error => {
    if (isOperatorWorkCurrent(epoch)) toast.error("Could not change on-air state", { description: String(error) })
    return false
  }).finally(() => { if (pendingLive === job) pendingLive = null })
  pendingLive = job
  pendingLiveEpoch = epoch
  return job
}

/** Keep one operation per output while native dialogs/commands are pending. */
function outputJob(id: string, action: () => Promise<boolean>): Promise<boolean> {
  if (isOperatorMaintenanceActive()) return Promise.resolve(false)
  const pending = outputJobs.get(id)
  if (pending) return pending
  const job = action().catch(error => {
    toast.error("Could not change output", { description: String(error) })
    return false
  }).finally(() => { if (outputJobs.get(id) === job) { outputJobs.delete(id); notifyOutputChanges() } })
  outputJobs.set(id, job)
  notifyOutputChanges()
  return job
}

export const hasPendingOutputChanges = () => outputJobs.size > 0

async function confirmStop(output: BroadcastOutput, action: string) {
  const inspection = await inspectOutput(output)
  if (currentOutput(output.id) !== output) return null
  if ((inspection.status.previewOpen || inspection.status.ndiActive || inspection.uncertain) && !await ask(
    `${action} “${output.name}”? This may interrupt the audience output.`,
    { title: "Change broadcast output", kind: "warning", okLabel: action, cancelLabel: "Keep output" },
  )) return null
  return currentOutput(output.id) === output ? inspection : null
}

export function setOutputEnabled(id: string, enabled: boolean): Promise<boolean> {
  return outputJob(id, async () => {
    const output = currentOutput(id)
    if (!output) return false
    if (enabled) {
      const version = outputRuntimeVersion(id)
      const inspection = await inspectOutput(output)
      const unchanged = () => currentOutput(id) === output && outputRuntimeVersion(id) === version
      if (!unchanged()) return false
      const active = output.type === "ndi" ? inspection.status.ndiActive : inspection.status.previewOpen
      if (active) {
        useBroadcastStore.getState().setOutputStatus(id, inspection.status)
        return true
      }
      if (inspection.uncertain && !await ask(`Start “${output.name}”? Its current status is unavailable; restarting may interrupt an active output.`, {
        title: "Output status unavailable", kind: "warning", okLabel: "Start output", cancelLabel: "Keep output",
      })) return false
      return unchanged() ? enableOutput(output) : false
    }
    const inspection = await confirmStop(output, "Stop output")
    if (!inspection) return false
    if (!inspection.hasWindow && !inspection.status.ndiActive && !inspection.uncertain) return true
    return disableOutput(output)
  })
}

export function removeOutputSafely(id: string): Promise<boolean> {
  if (id === MAIN_OUTPUT_ID) return Promise.resolve(false)
  return outputJob(id, async () => {
    const output = currentOutput(id)
    if (!output) return false
    const inspection = await confirmStop(output, "Remove output")
    if (!inspection) return false
    if ((inspection.hasWindow || inspection.status.ndiActive || inspection.uncertain) && !await disableOutput(output)) return false
    if (currentOutput(id) !== output) return false
    useBroadcastStore.getState().removeOutput(id)
    toast.success(`Removed ${output.name}`)
    return true
  })
}

export function updateOutputSafely(next: BroadcastOutput): Promise<boolean> {
  return outputJob(next.id, async () => {
    const existing = currentOutput(next.id)
    if (!existing) return false
    const changed = transportChanged(existing, next)
    const inspection = changed ? await confirmStop(existing, "Change output settings") : null
    if (changed && !inspection) return false
    const wasOnAir = Boolean(inspection?.status.previewOpen || inspection?.status.ndiActive)
    if (inspection && (inspection.hasWindow || inspection.status.ndiActive || inspection.uncertain) && !await disableOutput(existing)) return false
    if (currentOutput(next.id) !== existing) return false
    useBroadcastStore.getState().updateOutput(next.id, next)
    return wasOnAir ? enableOutput(currentOutput(next.id)!) : true
  })
}
