import { useCallback } from "react"
import { useSettingsStore } from "@/stores/settings-store"
import { useBibleStore } from "@/stores/bible-store"
import { displayBooks, displayVerseReference } from "@/lib/book-display-names"
import type { Verse } from "@/types"
import { translationCode } from "@/lib/translation-selection"

/** A display adapter; callers retain canonical rows and action identities. */
export function currentDisplayBooks() {
  const bible = useBibleStore.getState()
  return displayBooks(
    bible.books,
    bible.activeTranslationCode,
    useSettingsStore.getState().bookDisplayOverrides
  )
}

export function useDisplayVerseReference() {
  const names = useSettingsStore((state) => state.bookDisplayOverrides)
  const translations = useBibleStore((state) => state.translations)
  return useCallback(
    (
      verse: Pick<Verse, "book_name" | "book_number" | "chapter" | "verse"> & {
        translation_id?: number | null
      },
      code?: string | null,
      chapterOnly = false,
      reference?: string
    ) => {
      const metadata = translations.find(
        (item) => item.id === verse.translation_id
      )
      return displayVerseReference(
        verse,
        code ?? (metadata ? translationCode(metadata) : null),
        names,
        chapterOnly,
        reference
      )
    },
    [names, translations]
  )
}
