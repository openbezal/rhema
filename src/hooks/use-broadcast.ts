import { invoke } from "@tauri-apps/api/core"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useBibleStore } from "@/stores/bible-store"
import type { VerseRenderData } from "@/types"
import type { Verse } from "@/types"

export function toVerseRenderData(verse: Verse, translation: string): VerseRenderData {
  return {
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse} (${translation})`,
    segments: [{ verseNumber: verse.verse, text: verse.text }],
  }
}

/**
 * Refetch the full verse from the backend and present it to preview + live
 * output. Queue/detection items may carry partial verse objects (empty text,
 * synthetic id 0, stale translation_id), so always look the verse up by
 * book/chapter/verse against the active translation. Falls back to the passed
 * verse if the lookup fails — never blanks the output on error.
 */
export async function presentVerse(verse: Verse): Promise<void> {
  let verseToPresent = verse
  try {
    const fullVerse = await invoke<Verse | null>("get_verse", {
      translationId: useBibleStore.getState().activeTranslationId,
      bookNumber: verse.book_number,
      chapter: verse.chapter,
      verse: verse.verse,
    })
    verseToPresent = fullVerse ?? verse
  } catch (e) {
    console.warn("[broadcast] get_verse refetch failed, using cached verse:", e)
  }

  const bibleState = useBibleStore.getState()
  const translation =
    bibleState.translations.find((t) => t.id === bibleState.activeTranslationId)
      ?.abbreviation ?? "KJV"

  // Update selectedVerse too: live-output-panel re-derives the live verse
  // from selectedVerse, so it must carry the same (refetched) text.
  bibleState.selectVerse(verseToPresent)
  useBroadcastStore
    .getState()
    .setLiveVerse(toVerseRenderData(verseToPresent, translation))
}

export function deriveLiveVerse({
  isLive,
  selectedVerse,
  translation,
}: {
  isLive: boolean
  selectedVerse: Verse | null
  translation: string
}): VerseRenderData | null {
  if (!isLive || !selectedVerse) return null
  return toVerseRenderData(selectedVerse, translation)
}

export const broadcastActions = {
  setLiveVerse: (verse: VerseRenderData | null) =>
    useBroadcastStore.getState().setLiveVerse(verse),
  setLive: (live: boolean) =>
    useBroadcastStore.getState().setLive(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  },
}
