import { invoke } from "@tauri-apps/api/core"
import { shortcutDefinitions, type ShortcutId } from "./shortcut-registry"
import { runShortcutCommand } from "./operator-shortcuts"
import { useBibleStore, activateTranslation } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { translationCode } from "./translation-selection"
import { openSettings, type SettingsSection } from "./settings-dialog"
import {
  reservePresentationIntent,
  isPresentationIntentCurrent,
  matchesResolvedVerse,
} from "./presentation-controller"
import { operatorActions } from "./operator-actions"
import { displayBooks } from "./book-display-names"
import { useSettingsStore } from "@/stores/settings-store"
import type { Verse } from "@/types"
export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  run: () => unknown
}
export interface RemoteServerStatus {
  running: boolean
  port: number | null
}
type RemoteKind = "osc" | "http"
const remoteJobs: Record<RemoteKind, Promise<unknown>> = {
  osc: Promise.resolve(),
  http: Promise.resolve(),
}
/** Settings and palette share per-server serialization and fresh native status. */
export function setRemoteServerRunning(
  kind: RemoteKind,
  running: boolean,
  port = kind === "osc" ? 8000 : 8080
): Promise<RemoteServerStatus> {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    return Promise.reject(
      new Error("Port must be a whole number from 0 to 65535")
    )
  const job = remoteJobs[kind].then(async () => {
    const status = await invoke<RemoteServerStatus>(`get_${kind}_status`)
    if (status.running === running) return status
    if (running) {
      const boundPort = await invoke<number>(`start_${kind}`, { port })
      return { running: true, port: boundPort }
    }
    await invoke(`stop_${kind}`)
    return { running: false, port: null }
  })
  remoteJobs[kind] = job.catch(() => {})
  return job
}
/** Palette reference input requires a full book name or exact abbreviation.
 * Free/ambiguous prefixes stay in Search's deliberate completion workflow. */
export async function browsePaletteReference(query: string): Promise<void> {
  const state = useBibleStore.getState()
  if (state.translationSelectionStatus !== "ready")
    throw new Error("Confirm a Bible translation first")
  const normalizeBook = (value: string) =>
    value
      .normalize("NFKC")
      .trim()
      .replace(
        /^(III|II|I)\s+/iu,
        (prefix) =>
          ({ i: "1", ii: "2", iii: "3" })[prefix.trim().toLowerCase()]!
      )
      .toLowerCase()
      .replace(/[\s.]+/gu, "")
  const parts = query
    .trim()
    .match(/^(.+?\D)\s*(\d{1,3})\s*[:.\s]\s*(\d{1,3})$/u)
  const books = displayBooks(
    state.books,
    state.activeTranslationCode,
    useSettingsStore.getState().bookDisplayOverrides
  )
  const canonical = parts
    ? books.filter((book) =>
        [book.name, book.abbreviation].some(
          (name) => normalizeBook(name) === normalizeBook(parts[1])
        )
      )
    : []
  const exact = canonical.length
    ? canonical
    : parts
      ? books.filter(
          (book) => normalizeBook(book.displayName) === normalizeBook(parts[1])
        )
      : []
  const chapter = Number(parts?.[2])
  const verse = Number(parts?.[3])
  if (exact.length !== 1 || chapter < 1 || verse < 1)
    throw new Error(
      "Enter a full book name and chapter:verse, for example John 3:16"
    )
  const ticket = reservePresentationIntent()
  const coordinates = {
    book_number: exact[0].book_number,
    chapter,
    verse,
  }
  const row = await invoke<Verse | null>("get_verse", {
    translationId: state.activeTranslationId,
    bookNumber: coordinates.book_number,
    chapter: coordinates.chapter,
    verse: coordinates.verse,
  })
  if (
    !isPresentationIntentCurrent(ticket) ||
    useBibleStore.getState().activeTranslationId !== state.activeTranslationId
  )
    return
  if (!matchesResolvedVerse(row, coordinates, state.activeTranslationId))
    throw new Error("Verse unavailable in the selected translation")
  useBibleStore.getState().setPendingNavigation({
    bookNumber: row.book_number,
    chapter: row.chapter,
    verse: row.verse,
    presentationRevision: ticket,
  })
}
const sections: [SettingsSection, string][] = [
  ["audio", "Audio"],
  ["speech", "Speech Recognition"],
  ["bible", "Bible"],
  ["display", "Display Mode"],
  ["detections", "Detections"],
  ["remote", "Remote Control"],
  ["diagnostics", "Diagnostics"],
  ["help", "Help"],
]
export function paletteCommands(
  catalog = useBibleStore.getState().translations,
  themes = useBroadcastStore.getState().themes
): PaletteCommand[] {
  const commands: PaletteCommand[] = shortcutDefinitions
    .filter(
      (item) =>
        item.group !== "Focused list" &&
        !["escape", "show-commands"].includes(item.id)
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.bindings.join(" / "),
      run: () =>
        runShortcutCommand(item.id as ShortcutId, new KeyboardEvent("keydown")),
    }))
  const translations = catalog.filter((item) => item.is_downloaded)
  for (const translation of translations) {
    const code = translationCode(translation)
    if (
      translations.filter((item) => translationCode(item) === code).length !== 1
    )
      continue
    commands.push({
      id: `translation:${code}`,
      label: `Switch translation to ${code}`,
      run: async () => {
        const matches = useBibleStore
          .getState()
          .translations.filter(
            (item) => item.is_downloaded && translationCode(item) === code
          )
        if (matches.length !== 1)
          throw new Error("Translation is unavailable or ambiguous")
        await activateTranslation(matches[0].id)
      },
    })
  }
  for (const theme of themes)
    commands.push({
      id: `theme:${theme.id}`,
      label: `Use theme ${theme.name}`,
      run: () => {
        if (
          !useBroadcastStore
            .getState()
            .themes.some((item) => item.id === theme.id)
        )
          throw new Error("Theme unavailable")
        useBroadcastStore.getState().setActiveTheme(theme.id)
      },
    })
  for (const [id, label] of sections)
    commands.push({
      id: `settings:${id}`,
      label: `Open ${label} settings`,
      run: () => openSettings(id),
    })
  commands.push(
    {
      id: "queue-preview",
      label: "Queue Program preview",
      run: operatorActions.addToQueue,
    },
    {
      id: "present-preview",
      label: "Present Program preview",
      run: operatorActions.sendToLive,
    },
    {
      id: "toggle-auto",
      label: "Toggle Auto live",
      run: operatorActions.toggleAutoLive,
    }
  )
  for (const mode of ["background", "transparent", "black"] as const)
    commands.push({
      id: `clear:${mode}`,
      label: `Clear live to ${mode}`,
      run: () => operatorActions.clearLive(mode),
    })
  for (const kind of ["osc", "http"] as const)
    for (const running of [true, false])
      commands.push({
        id: `remote:${kind}:${running}`,
        label: `${running ? "Start" : "Stop"} ${kind.toUpperCase()} server`,
        run: () => setRemoteServerRunning(kind, running),
      })
  return commands
}
