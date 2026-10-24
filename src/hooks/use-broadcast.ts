import { invoke } from "@tauri-apps/api/core"
import { mark } from "@/lib/latency-marks"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import type { VerseRenderData } from "@/types"
import type { Verse } from "@/types"

export function toVerseRenderData(
  verse: Verse,
  translation: string
): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
  }
}

/**
 * Build one live payload for multiple translations of the same reference.
 * Keeping the translations in one payload means every output advances from
 * the same detected scripture instead of running competing presentation
 * paths.
 */
export function toDualVerseRenderData(
  entries: Array<{ verse: Verse; translation: string }>
): VerseRenderData {
  const first = entries[0]
  if (!first) {
    return { reference: "", segments: [] }
  }

  return {
    reference: `${first.verse.book_name} ${first.verse.chapter}:${first.verse.verse}`,
    segments: [{ text: first.verse.text }],
    translationLines: entries.map(({ verse }) => verse.text),
  }
}

export function getTranslationLabel(
  translationId: number,
  fallback: string
): string {
  return (
    useBibleStore
      .getState()
      .translations.find((translation) => translation.id === translationId)
      ?.abbreviation ?? fallback
  )
}

// Monotonic ticket so an older present whose refetch resolves late can't
// overwrite a newer one (detections can present in quick succession).
let presentSeq = 0

/**
 * Refetch the full verse from the backend and present it to preview + live
 * output. Queue/detection items may carry partial verse objects (empty text,
 * synthetic id 0, stale translation_id), so always look the verse up by
 * book/chapter/verse against the active translation. Falls back to the passed
 * verse if the lookup fails — never blanks the output on error.
 *
 * This is the ONLY path that changes the live output verse. Manual selection
 * (verse click, arrow navigation, search) presents directly; detections update
 * only the preview unless the Auto toggle is on.
 */
export async function presentVerse(verse: Verse): Promise<void> {
  presentSeq += 1
  const ticket = presentSeq
  mark(`presentVerse start ${verse.book_name} ${verse.chapter}:${verse.verse}`)

  const bibleState = useBibleStore.getState()
  const primaryTranslationId = bibleState.activeTranslationId
  const secondaryTranslationId = bibleState.secondaryTranslationId
  const translationIds = [
    primaryTranslationId,
    ...(secondaryTranslationId !== null &&
    secondaryTranslationId !== primaryTranslationId
      ? [secondaryTranslationId]
      : []),
  ]

  const fetchedVerses = await Promise.all(
    translationIds.map(async (translationId) => {
      try {
        return await invoke<Verse | null>("get_verse", {
          translationId,
          bookNumber: verse.book_number,
          chapter: verse.chapter,
          verse: verse.verse,
        })
      } catch (e) {
        console.warn(
          `[broadcast] get_verse refetch failed for translation ${translationId}`,
          e
        )
        return null
      }
    })
  )
  const verseToPresent = fetchedVerses[0] ?? verse
  mark(
    `presentVerse get_verse done ${verse.book_name} ${verse.chapter}:${verse.verse}`
  )

  // A newer present started while we were refetching — let it win.
  if (ticket !== presentSeq) return

  // Never present a verse with no text (e.g. a citation that doesn't exist
  // in the active translation) — keep whatever is currently live instead.
  if (!verseToPresent.text?.trim()) {
    console.warn(
      "[broadcast] refusing to present verse with empty text:",
      `${verseToPresent.book_name} ${verseToPresent.chapter}:${verseToPresent.verse}`
    )
    return
  }

  const renderEntries = fetchedVerses
    .map((fetchedVerse, index) => {
      const sourceVerse = fetchedVerse ?? (index === 0 ? verse : null)
      if (!sourceVerse?.text?.trim()) return null
      return {
        verse: sourceVerse,
        translation: getTranslationLabel(
          translationIds[index],
          index === 0 ? "KJV" : "Translation"
        ),
      }
    })
    .filter(
      (entry): entry is { verse: Verse; translation: string } => entry !== null
    )

  // Keep the preview in sync with what was just presented.
  bibleState.selectVerse(verseToPresent)
  useBroadcastStore
    .getState()
    .setLiveVerse(
      renderEntries.length > 1
        ? toDualVerseRenderData(renderEntries)
        : toVerseRenderData(
            renderEntries[0]?.verse ?? verseToPresent,
            renderEntries[0]?.translation ?? "KJV"
          ),
      verseToPresent
    )
  mark(
    `presentVerse end ${verseToPresent.book_name} ${verseToPresent.chapter}:${verseToPresent.verse}`
  )
}

export const broadcastActions = {
  setLiveVerse: (verse: VerseRenderData | null) =>
    useBroadcastStore.getState().setLiveVerse(verse),
  setLive: (live: boolean) => useBroadcastStore.getState().setLive(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  },
}
