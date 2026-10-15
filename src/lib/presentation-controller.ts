import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { mark } from "@/lib/latency-marks"
import { translationCode } from "@/lib/translation-selection"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Verse, VerseRenderData, OutputClearMode } from "@/types"

interface PresentOptions {
  selectPreview?: boolean
  /** A caller may reserve intent before its chapter/reference lookup. */
  intentRevision?: number
}
interface Intent {
  reference: Verse
  selectPreview: boolean
}
let revision = 0
let pendingIntent: Intent | null = null
let connections = 0
let disconnect: (() => void) | null = null

function selection() {
  const bible = useBibleStore.getState()
  const metadata = bible.translations.find(
    (item) => item.id === bible.activeTranslationId && item.is_downloaded
  )
  if (
    bible.translationSelectionStatus !== "ready" ||
    !metadata ||
    translationCode(metadata) !== bible.activeTranslationCode
  )
    return null
  return { id: metadata.id, code: translationCode(metadata) }
}
function selectionKey() {
  const bible = useBibleStore.getState()
  const metadata = bible.translations.find(
    (item) => item.id === bible.activeTranslationId
  )
  return `${bible.activeTranslationId}|${bible.activeTranslationCode}|${bible.translationSelectionStatus}|${metadata?.abbreviation}|${metadata?.is_downloaded}`
}
function validReference(verse: Verse) {
  return (
    Number.isInteger(verse.book_number) &&
    verse.book_number >= 1 &&
    verse.book_number <= 66 &&
    Number.isInteger(verse.chapter) &&
    verse.chapter > 0 &&
    Number.isInteger(verse.verse) &&
    verse.verse > 0
  )
}

export function toVerseRenderData(
  verse: Verse,
  translation: string
): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
  }
}

/** Only text verified against the current translation/reference can commit. */
export async function presentVerse(
  verse: Verse,
  options: PresentOptions = {}
): Promise<void> {
  if (
    options.intentRevision !== undefined &&
    !isPresentationIntentCurrent(options.intentRevision)
  )
    return
  const selected = selection()
  if (!selected || !validReference(verse)) return
  const intent: Intent = {
    reference: { ...verse },
    selectPreview: options.selectPreview !== false,
  }
  pendingIntent = intent
  const ticket = ++revision
  const startedLive = useBroadcastStore.getState().isLive
  const current = () => {
    const now = selection()
    return (
      ticket === revision &&
      now?.id === selected.id &&
      now.code === selected.code &&
      !(startedLive && !useBroadcastStore.getState().isLive)
    )
  }
  const reference = intent.reference
  mark(
    `presentVerse start ${reference.book_name} ${reference.chapter}:${reference.verse}`
  )
  try {
    const full = await invoke<Verse | null>("get_verse", {
      translationId: selected.id,
      bookNumber: reference.book_number,
      chapter: reference.chapter,
      verse: reference.verse,
    })
    mark(
      `presentVerse get_verse done ${reference.book_name} ${reference.chapter}:${reference.verse}`
    )
    if (!current()) return
    if (
      !full ||
      full.translation_id !== selected.id ||
      full.book_number !== reference.book_number ||
      full.chapter !== reference.chapter ||
      full.verse !== reference.verse ||
      typeof full.text !== "string" ||
      !full.text.trim()
    ) {
      toast.error("Verse unavailable in the selected translation", {
        id: "presentation-lookup",
        description: "The previous live content has been retained.",
      })
      return
    }
    if (intent.selectPreview) useBibleStore.getState().selectVerse(full)
    if (!current()) return
    useBroadcastStore
      .getState()
      .setLiveVerse(toVerseRenderData(full, selected.code), full)
    mark(`presentVerse end ${full.book_name} ${full.chapter}:${full.verse}`)
  } catch (error) {
    if (current())
      toast.error("Could not load the requested verse", {
        id: "presentation-lookup",
        description: String(error),
      })
  } finally {
    if (ticket === revision && pendingIntent === intent) pendingIntent = null
  }
}

/** Cancel unfinished work while retaining the last valid content. */
export function invalidatePresentation(): void {
  revision++
  pendingIntent = null
}
/** Claim operator intent before work that precedes the final verse lookup. */
export function reservePresentationIntent(): number {
  invalidatePresentation()
  return revision
}
export function isPresentationIntentCurrent(ticket: number): boolean {
  return ticket === revision
}
export function clearLive(mode: OutputClearMode): void {
  invalidatePresentation()
  useBroadcastStore.getState().setLiveVerse(null, null, mode)
}
export function refreshLiveVerse(): Promise<void> {
  const intent = pendingIntent
  const source =
    intent?.reference ?? useBroadcastStore.getState().liveSourceVerse
  return source
    ? presentVerse(source, { selectPreview: intent?.selectPreview ?? false })
    : Promise.resolve()
}

/** App-owned refresh/cancellation; overlapping root leases share one subscription. */
export function connectPresentationController(): () => void {
  if (connections++ === 0) {
    let key = selectionKey()
    const bible = useBibleStore.subscribe(() => {
      const next = selectionKey()
      if (next === key) return
      key = next
      revision++
      if (selection()) void refreshLiveVerse()
    })
    const broadcast = useBroadcastStore.subscribe((state, previous) => {
      if (previous.isLive && !state.isLive) invalidatePresentation()
    })
    disconnect = () => {
      bible()
      broadcast()
      invalidatePresentation()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--connections === 0) {
      disconnect?.()
      disconnect = null
    }
  }
}
