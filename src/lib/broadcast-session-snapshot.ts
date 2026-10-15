import type {
  BroadcastOutput,
  BroadcastTheme,
  OutputClearMode,
  Verse,
  VerseRenderData,
} from "@/types"
import type { BroadcastTrace } from "./broadcast-trace"
export interface BroadcastSessionSnapshot {
  isLive: boolean
  liveVerse: VerseRenderData | null
  liveSourceVerse: Verse | null
  liveTrace: BroadcastTrace | null
  clearMode: OutputClearMode
  hasExplicitClear: boolean
  autoLive: boolean
  outputs: BroadcastOutput[]
  activeThemeId: string
  themes: BroadcastTheme[]
  draftTheme: BroadcastTheme | null
  editingThemeId: string | null
  isDesignerOpen: boolean
}
let processIdentity: string | null = null
export const broadcastSnapshotProcessIdentity = () => processIdentity
export function setBroadcastProcessIdentity(identity: string): void {
  processIdentity = identity
}
const KEY = "rhema.broadcast-session.v1"
function checksum(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash >>> 0
}
/** Same top-level webview session only. Never save on-air state in disk preferences. */
export function readBroadcastSession(): BroadcastSessionSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const envelope = JSON.parse(raw)
    if (
      envelope.version !== 1 ||
      typeof envelope.payload !== "string" ||
      checksum(envelope.payload) !== envelope.checksum
    )
      return null
    const data = JSON.parse(envelope.payload) as BroadcastSessionSnapshot
    if (
      typeof data.isLive !== "boolean" ||
      typeof data.autoLive !== "boolean" ||
      typeof data.hasExplicitClear !== "boolean" ||
      !["transparent", "black", "background"].includes(data.clearMode) ||
      !Array.isArray(data.outputs) ||
      !data.outputs.some((output) => output.id === "main") ||
      !Array.isArray(data.themes) ||
      !data.themes.length
    )
      return null
    processIdentity =
      typeof envelope.processIdentity === "string"
        ? envelope.processIdentity
        : null
    return data
  } catch {
    return null
  }
}
export function writeBroadcastSession(state: BroadcastSessionSnapshot): void {
  try {
    const {
      isLive,
      liveVerse,
      liveSourceVerse,
      liveTrace,
      clearMode,
      hasExplicitClear,
      autoLive,
      outputs,
      activeThemeId,
      themes,
      draftTheme,
      editingThemeId,
      isDesignerOpen,
    } = state
    const payload = JSON.stringify({
      isLive,
      liveVerse,
      liveSourceVerse,
      liveTrace,
      clearMode,
      hasExplicitClear,
      autoLive,
      outputs,
      activeThemeId,
      themes,
      draftTheme,
      editingThemeId,
      isDesignerOpen,
    })
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        processIdentity,
        payload,
        checksum: checksum(payload),
      })
    )
  } catch {
    // Never retain a stale recoverable verse after a failed/quota-limited write.
    forgetBroadcastSession()
  }
}
export function forgetBroadcastSession(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* unavailable storage => unknown after reload */
  }
}
