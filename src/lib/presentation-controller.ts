import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { mark } from "@/lib/latency-marks"
import {
  createBroadcastTrace,
  markBroadcastTrace,
  type BroadcastTrace,
} from "@/lib/broadcast-trace"
import { translationCode } from "@/lib/translation-selection"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Verse, VerseRenderData, OutputClearMode } from "@/types"

interface PresentOptions {
  selectPreview?: boolean
  automatic?: boolean
  /** Keep the original preview permission across translation refreshes. */
  followRevision?: number
  /** A caller may reserve intent before its chapter/reference lookup. */
  intentRevision?: number
}
interface Intent {
  reference: Verse
  selectPreview: boolean
  automatic: boolean
  followRevision: number
}
let reservedTrace: { revision: number; trace: BroadcastTrace } | null = null
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
  const optional = bible.translations.filter(
    (item) =>
      item.is_downloaded &&
      translationCode(item) === bible.secondaryTranslationCode &&
      translationCode(item) !== bible.activeTranslationCode
  )
  return {
    id: metadata.id,
    code: translationCode(metadata),
    secondary:
      optional.length === 1
        ? { id: optional[0].id, code: translationCode(optional[0]) }
        : null,
  }
}
function selectionKey(bible = useBibleStore.getState()) {
  const metadata = bible.translations.find(
    (item) => item.id === bible.activeTranslationId
  )
  return `${bible.activeTranslationId}|${bible.activeTranslationCode}|${bible.translationSelectionStatus}|${metadata?.abbreviation}|${metadata?.is_downloaded}|${bible.secondaryTranslationCode}|${bible.translations
    .filter((item) => translationCode(item) === bible.secondaryTranslationCode)
    .map((item) => `${item.id}:${item.abbreviation}:${item.is_downloaded}`)
    .join(",")}`
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
  translation: string,
  secondary?: { verse: Verse; code: string } | null
): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation}${secondary ? ` · ${secondary.code}` : ""})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
    ...(secondary
      ? {
          secondary: {
            translationCode: secondary.code,
            segments: [
              {
                verseNumber: secondary.verse.verse,
                text: secondary.verse.text,
              },
            ],
          },
        }
      : {}),
  }
}

export function matchesResolvedVerse(
  row: Verse | null,
  reference: Verse,
  translationId: number
): row is Verse {
  return Boolean(
    row &&
    row.translation_id === translationId &&
    row.book_number === reference.book_number &&
    row.chapter === reference.chapter &&
    row.verse === reference.verse &&
    typeof row.text === "string" &&
    row.text.trim()
  )
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
  if (useBroadcastStore.getState().presentationRecovery !== "ready") return
  const selected = selection()
  const selectedKey = selectionKey()
  if (!selected || !validReference(verse)) return
  // A manual selection takes ownership from unfinished automatic browsing.
  if (
    options.selectPreview !== false &&
    useBibleStore.getState().pendingNavigation?.follow
  ) {
    useBibleStore.getState().setPendingNavigation(null)
  }
  const intent: Intent = {
    reference: { ...verse },
    selectPreview: options.selectPreview !== false,
    automatic: options.automatic === true,
    followRevision:
      options.followRevision ?? useBibleStore.getState().followRevision,
  }
  pendingIntent = intent
  const inheritedTrace =
    options.intentRevision !== undefined &&
    reservedTrace?.revision === options.intentRevision
      ? reservedTrace.trace
      : null
  reservedTrace = null
  const ticket = ++revision
  const trace = inheritedTrace ?? createBroadcastTrace()
  if (!inheritedTrace) markBroadcastTrace(trace, "intent_accepted")
  const startedLive = useBroadcastStore.getState().isLive
  const current = () => {
    const now = selection()
    return (
      ticket === revision &&
      selectionKey() === selectedKey &&
      useBroadcastStore.getState().presentationRecovery === "ready" &&
      (!intent.automatic || useBroadcastStore.getState().autoLive) &&
      now?.id === selected.id &&
      now.code === selected.code &&
      !(startedLive && !useBroadcastStore.getState().isLive)
    )
  }
  const reference = intent.reference
  const optional = lookupSecondaryVerse(reference, selected.secondary)
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
    markBroadcastTrace(trace, "resolved")
    if (!current()) return
    if (!matchesResolvedVerse(full, reference, selected.id)) {
      toast.error("Verse unavailable in the selected translation", {
        id: "presentation-lookup",
        description: "The previous live content has been retained.",
      })
      return
    }
    if (
      intent.selectPreview &&
      (!intent.automatic ||
        (useBibleStore.getState().followDetections &&
          useBibleStore.getState().followRevision === intent.followRevision))
    )
      useBibleStore.getState().selectVerse(full)
    if (!current()) return
    // Preview permission belongs only to the unfinished primary lookup. The
    // optional response may enrich this presentation, never reclaim browsing.
    if (pendingIntent === intent) pendingIntent = null
    useBroadcastStore
      .getState()
      .setLiveVerse(
        toVerseRenderData(full, selected.code),
        full,
        "background",
        trace
      )
    const second = await optional
    if (current() && selected.secondary) {
      if (matchesResolvedVerse(second, reference, selected.secondary.id)) {
        useBroadcastStore.getState().setLiveVerse(
          toVerseRenderData(full, selected.code, {
            verse: second,
            code: selected.secondary.code,
          }),
          full,
          "background",
          trace
        )
      } else
        toast.warning("Secondary verse unavailable", {
          id: "presentation-secondary",
          description: "The verified primary translation is retained.",
        })
    }
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
  reservedTrace = null
  revision++
  pendingIntent = null
}
/** Claim operator intent before work that precedes the final verse lookup. */
export function reservePresentationIntent(): number {
  invalidatePresentation()
  const trace = createBroadcastTrace()
  markBroadcastTrace(trace, "intent_accepted")
  reservedTrace = { revision, trace }
  return revision
}
export function isPresentationIntentCurrent(ticket: number): boolean {
  return ticket === revision
}
export function clearLive(mode: OutputClearMode): void {
  const trace = createBroadcastTrace()
  markBroadcastTrace(trace, "intent_accepted")
  invalidatePresentation()
  useBroadcastStore.getState().setLiveVerse(null, null, mode, trace)
}
export function refreshLiveVerse(): Promise<void> {
  const intent = pendingIntent
  const source =
    intent?.reference ?? useBroadcastStore.getState().liveSourceVerse
  return source
    ? presentVerse(source, {
        selectPreview: intent?.selectPreview ?? false,
        automatic: intent?.automatic ?? false,
        followRevision: intent?.followRevision,
      })
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
      const languages = selection()
      const live = useBroadcastStore.getState()
      if (
        !useBibleStore.getState().secondaryTranslationCode &&
        live.liveVerse?.secondary
      ) {
        // None applies to the committed pixels immediately, even if a newly
        // selected primary is still loading. Keep the committed primary label.
        const primaryOnly = { ...live.liveVerse }
        const suffix = ` · ${live.liveVerse.secondary.translationCode})`
        if (primaryOnly.reference.endsWith(suffix))
          primaryOnly.reference =
            primaryOnly.reference.slice(0, -suffix.length) + ")"
        delete primaryOnly.secondary
        live.setLiveVerse(primaryOnly, live.liveSourceVerse)
      }
      if (languages) void refreshLiveVerse()
    })
    const broadcast = useBroadcastStore.subscribe((state, previous) => {
      if (
        (previous.isLive && !state.isLive) ||
        (previous.autoLive && !state.autoLive && pendingIntent?.automatic)
      )
        invalidatePresentation()
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

/** Shared optional resolver for live presentation and browsed preview. */
export async function lookupSecondaryVerse(
  reference: Verse,
  selected: { id: number; code: string } | null
): Promise<Verse | null> {
  if (!selected) return null
  try {
    const row = await invoke<Verse | null>("get_verse", {
      translationId: selected.id,
      bookNumber: reference.book_number,
      chapter: reference.chapter,
      verse: reference.verse,
    })
    return matchesResolvedVerse(row, reference, selected.id) ? row : null
  } catch {
    return null
  }
}
export {
  selection as currentPresentationSelection,
  selectionKey as presentationSelectionKey,
}
