import { toast } from "sonner"
import { info as logInfo, error as logError } from "@tauri-apps/plugin-log"
import { invoke } from "@tauri-apps/api/core"
import { emitTo } from "@tauri-apps/api/event"
import { getAllWindows } from "@tauri-apps/api/window"
import { useBroadcastStore } from "@/stores"
import type {
  BroadcastOutput,
  NdiAlphaMode,
  NdiFrameRate,
  NdiResolution,
  NdiSessionInfo,
  NdiStartRequest,
} from "@/types"
import { outputWindowLabel } from "@/types"

export const NDI_RESOLUTION_OPTIONS: Array<{ value: NdiResolution; label: string }> = [
  { value: "r1080p", label: "1080p (1920×1080)" },
  { value: "r720p", label: "720p (1280×720)" },
  { value: "r4k", label: "4K (3840×2160)" },
]

export const NDI_FRAME_RATE_OPTIONS: Array<{ value: NdiFrameRate; label: string }> = [
  { value: "fps24", label: "24 fps" },
  { value: "fps30", label: "30 fps" },
  { value: "fps60", label: "60 fps" },
]

export const NDI_ALPHA_OPTIONS: Array<{ value: NdiAlphaMode; label: string }> = [
  { value: "noneOpaque", label: "None (Opaque)" },
  { value: "straightAlpha", label: "Straight Alpha" },
  { value: "premultipliedAlpha", label: "Premultiplied Alpha" },
]

export function ndiFrameRateToNumber(frameRate: NdiFrameRate): number {
  switch (frameRate) {
    case "fps24":
      return 24
    case "fps30":
      return 30
    case "fps60":
      return 60
  }
}

export function ndiResolutionDimensions(resolution: NdiResolution): {
  width: number
  height: number
} {
  switch (resolution) {
    case "r720p":
      return { width: 1280, height: 720 }
    case "r4k":
      return { width: 3840, height: 2160 }
    case "r1080p":
      return { width: 1920, height: 1080 }
  }
}

/** Tell the output window whether (and how) to pump NDI frames. */
export function syncNdiConfigToOutput(output: BroadcastOutput, active: boolean): void {
  const dims = ndiResolutionDimensions(output.ndi.resolution)
  void emitTo(outputWindowLabel(output.id), "broadcast:ndi-config", {
    active,
    fps: ndiFrameRateToNumber(output.ndi.frameRate),
    width: dims.width,
    height: dims.height,
  }).catch(() => {})
}

/**
 * A window hidden for NDI still exists — only a visible one counts as an
 * open preview.
 */
async function isPreviewWindowVisible(outputId: string): Promise<boolean> {
  try {
    const windows = await getAllWindows()
    const window = windows.find((w) => w.label === outputWindowLabel(outputId))
    return window ? await window.isVisible() : false
  } catch {
    return false
  }
}

const outputVersions = new Map<string, number>()
const versionOf = (id: string) => outputVersions.get(id) ?? 0
const advanceVersion = (id: string) => {
  const version = versionOf(id) + 1
  outputVersions.set(id, version)
  return version
}

export function transportChanged(before: BroadcastOutput, after: BroadcastOutput): boolean {
  return before.type !== after.type || before.monitorIndex !== after.monitorIndex ||
    before.ndi.sourceName !== after.ndi.sourceName || before.ndi.resolution !== after.ndi.resolution ||
    before.ndi.frameRate !== after.ndi.frameRate || before.ndi.alphaMode !== after.ndi.alphaMode
}

/** Hidden renderers are implementation resources; only visible windows or active senders carry output. */
export async function inspectOutput(output: BroadcastOutput) {
  const [windowResult, ndiResult] = await Promise.allSettled([
    (async () => {
      const window = (await getAllWindows()).find(item => item.label === outputWindowLabel(output.id))
      return { exists: Boolean(window), visible: window ? await window.isVisible() : false }
    })(),
    invoke<{ active: boolean } | null>("get_ndi_status", { outputId: output.id }),
  ])
  return {
    status: {
      previewOpen: windowResult.status === "fulfilled" && windowResult.value.visible,
      ndiActive: ndiResult.status === "fulfilled" && (ndiResult.value?.active ?? false),
    },
    hasWindow: windowResult.status === "fulfilled" && windowResult.value.exists,
    uncertain: windowResult.status === "rejected" || ndiResult.status === "rejected",
  }
}

/** Ignore responses from a previous transport operation or replaced configuration. */
export async function reconcileOutputStatus(output: BroadcastOutput): Promise<void> {
  const version = versionOf(output.id)
  const { status } = await inspectOutput(output)
  const store = useBroadcastStore.getState()
  if (version !== versionOf(output.id) || store.outputs.find(item => item.id === output.id) !== output) return
  store.setOutputStatus(output.id, { ...status, error: store.outputStatus[output.id]?.error })
}

function nudgeOutput(output: BroadcastOutput, version: number, ndiActive: boolean) {
  const store = useBroadcastStore.getState()
  const current = store.outputs.find(item => item.id === output.id)
  const status = store.outputStatus[output.id]
  if (version !== versionOf(output.id) || !current || transportChanged(output, current) ||
      !(ndiActive ? status?.ndiActive : status?.previewOpen)) return
  store.syncBroadcastOutputFor(output.id)
  syncNdiConfigToOutput(current, ndiActive)
}

/** Start one transport. Operator-facing actions serialize and confirm changes in output-safety.ts. */
export async function enableOutput(output: BroadcastOutput): Promise<boolean> {
  advanceVersion(output.id)
  try {
    if (output.type === "display") {
      await invoke("open_broadcast_window", { outputId: output.id, monitorIndex: output.monitorIndex, title: output.name })
      const opened = await isPreviewWindowVisible(output.id)
      if (!opened) throw new Error("Display window did not become visible")
      const current = useBroadcastStore.getState().outputs.find(item => item.id === output.id)
      if (!current || transportChanged(output, current)) throw new Error("Output configuration changed during startup")
      const version = advanceVersion(output.id)
      const store = useBroadcastStore.getState()
      store.setOutputStatus(output.id, { previewOpen: true, ndiActive: false })
      store.syncBroadcastOutputFor(output.id)
      syncNdiConfigToOutput(output, false)
      setTimeout(() => nudgeOutput(output, version, false), 150)
      return true
    }
    await invoke("ensure_broadcast_window", { outputId: output.id, title: `${output.name} (NDI)` })
    const request: NdiStartRequest = { ...output.ndi }
    const session = await invoke<NdiSessionInfo>("start_ndi", { outputId: output.id, request })
    const current = useBroadcastStore.getState().outputs.find(item => item.id === output.id)
    if (!current || transportChanged(output, current)) throw new Error("Output configuration changed during startup")
    void logInfo(`[broadcast-ui] start_ndi '${output.id}' ok: ${session.sourceName} ${session.width}x${session.height}@${session.fps}`)
    const version = advanceVersion(output.id)
    const store = useBroadcastStore.getState()
    store.setOutputStatus(output.id, { previewOpen: false, ndiActive: true })
    store.syncBroadcastOutputFor(output.id)
    void emitTo(outputWindowLabel(output.id), "broadcast:ndi-config", { active: true, fps: session.fps, width: session.width, height: session.height }).catch(() => {})
    setTimeout(() => nudgeOutput(output, version, true), 300)
    return true
  } catch (error) {
    advanceVersion(output.id)
    await invoke("stop_ndi", { outputId: output.id }).catch(() => {})
    syncNdiConfigToOutput(output, false)
    await invoke("close_broadcast_window", { outputId: output.id }).catch(() => {})
    await reconcileOutputStatus(output)
    const store = useBroadcastStore.getState()
    if (store.outputs.some(item => item.id === output.id)) {
      store.setOutputStatus(output.id, { ...store.outputStatus[output.id], previewOpen: store.outputStatus[output.id]?.previewOpen ?? false, ndiActive: store.outputStatus[output.id]?.ndiActive ?? false, error: String(error) })
    }
    void logError(`[broadcast-ui] enable output '${output.id}' FAILED: ${String(error)}`)
    toast.error(output.type === "display" ? "Could not open display output" : "Could not start NDI", { description: String(error) })
    return false
  }
}

/** Stop the sender before closing; a failed stop/close must retain its configuration. */
export async function disableOutput(output: BroadcastOutput): Promise<boolean> {
  advanceVersion(output.id)
  try {
    await invoke("stop_ndi", { outputId: output.id })
    syncNdiConfigToOutput(output, false)
    await invoke("close_broadcast_window", { outputId: output.id })
    advanceVersion(output.id)
    useBroadcastStore.getState().setOutputStatus(output.id, { previewOpen: false, ndiActive: false })
    return true
  } catch (error) {
    advanceVersion(output.id)
    await reconcileOutputStatus(output)
    void logError(`[broadcast-ui] disable output '${output.id}' FAILED: ${String(error)}`)
    toast.error("Could not stop output", { description: String(error) })
    return false
  }
}
