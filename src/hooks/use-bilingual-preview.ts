import { useEffect, useState } from "react"
import { useBibleStore } from "@/stores/bible-store"
import { useSettingsStore } from "@/stores/settings-store"
import type { Verse } from "@/types"
import { translationCode } from "@/lib/translation-selection"
import {
  currentPresentationSelection,
  presentationSelectionKey,
  lookupSecondaryVerse,
  toVerseRenderData,
} from "@/lib/presentation-controller"
/** Preview keeps its source label until primary refresh settles. Optional text
 * can attach only to the same source object and current language selection. */
export function useBilingualPreview(verse: Verse | null) {
  const bookNames = useSettingsStore((state) => state.bookDisplayOverrides)
  const key = useBibleStore(presentationSelectionKey)
  const translations = useBibleStore((state) => state.translations)
  const [optional, setOptional] = useState<{
    source: Verse
    key: string
    row: Verse
    code: string
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    const languages = currentPresentationSelection()
    if (
      !verse ||
      !languages?.secondary ||
      verse.translation_id !== languages.id
    )
      return
    const selected = languages.secondary
    void lookupSecondaryVerse(verse, selected).then((row) => {
      if (
        !cancelled &&
        row &&
        presentationSelectionKey() === key &&
        useBibleStore.getState().selectedVerse === verse
      )
        setOptional({ source: verse, key, row, code: selected.code })
    })
    return () => {
      cancelled = true
    }
  }, [verse, key])
  if (!verse) return null
  const source = translations.find((item) => item.id === verse.translation_id)
  const code = source ? translationCode(source) : "Unknown translation"
  return toVerseRenderData(
    verse,
    code,
    optional?.source === verse && optional.key === key
      ? { verse: optional.row, code: optional.code }
      : null,
    bookNames
  )
}
