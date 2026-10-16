import { invoke } from "@tauri-apps/api/core"
import { getAllWindows } from "@tauri-apps/api/window"
import {
  useBroadcastStore,
  hasBroadcastSessionSnapshot,
} from "@/stores/broadcast-store"
import { defaultNdiSettings, MISSING_OUTPUT_RENDERER_ERROR } from "@/types"
import {
  broadcastSnapshotProcessIdentity,
  setBroadcastProcessIdentity,
} from "./broadcast-session-snapshot"
import { inspectOutput } from "./broadcast-output-control"

/** Reconcile surviving native resources before showing the operator controls. */
export async function initializeBroadcastRecovery(): Promise<void> {
  useBroadcastStore.setState({ presentationRecovery: "restoring" })
  let uncertain = false,
    orphaned = false,
    sameProcessSnapshot = false
  try {
    const [windows, senders, identity] = await Promise.all([
      getAllWindows(),
      invoke<string[]>("get_ndi_output_ids"),
      invoke<string>("get_broadcast_process_identity"),
    ])
    if (typeof identity !== "string" || !identity)
      throw new Error("Native broadcast identity unavailable")
    sameProcessSnapshot =
      hasBroadcastSessionSnapshot &&
      broadcastSnapshotProcessIdentity() === identity
    setBroadcastProcessIdentity(identity)
    if (!sameProcessSnapshot)
      useBroadcastStore.setState({
        isLive: false,
        liveVerse: null,
        liveSourceVerse: null,
        liveTrace: null,
        hasExplicitClear: false,
        clearMode: "background",
        draftTheme: null,
        editingThemeId: null,
        isDesignerOpen: false,
      })
    const ids = new Set([
      ...senders,
      ...windows
        .filter((item) => item.label.startsWith("broadcast-"))
        .map((item) => item.label.slice(10)),
    ])
    for (const id of ids) {
      if (
        useBroadcastStore.getState().outputs.some((output) => output.id === id)
      )
        continue
      orphaned = true
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue
      const state = useBroadcastStore.getState()
      state.addOutput({
        id,
        name: `Recovered output ${id}`,
        type: senders.includes(id) ? "ndi" : "display",
        themeId: state.activeThemeId,
        monitorIndex: 0,
        ndi: defaultNdiSettings(),
      })
    }
  } catch {
    uncertain = true
  }
  const outputs = useBroadcastStore.getState().outputs
  const states = await Promise.all(outputs.map(inspectOutput))
  states.forEach((result, index) =>
    useBroadcastStore
      .getState()
      .setOutputStatus(outputs[index].id, {
        ...result.status,
        ...(!result.hasWindow && result.status.ndiActive
          ? { error: MISSING_OUTPUT_RENDERER_ERROR }
          : {}),
      })
  )
  uncertain ||= states.some((result) => result.uncertain)
  const surviving = states.some(
    (result) => result.hasWindow || result.status.ndiActive
  )
  const missingRenderer = states.some(
    (result) => result.status.ndiActive && !result.hasWindow
  )
  const known =
    !uncertain &&
    !orphaned &&
    !missingRenderer &&
    (sameProcessSnapshot || !surviving)
  useBroadcastStore.setState({
    presentationRecovery: known ? "ready" : "unknown",
  })
  if (known) useBroadcastStore.getState().syncBroadcastOutput()
}
