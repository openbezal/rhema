import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import { presentPrimaryVerse } from "./presentation-controller"
import { translationCode } from "./translation-selection"
import type { SuggestionCandidate } from "./suggestion-history"
import type { Verse } from "@/types"
import { isOperatorWorkCurrent, operatorRevision } from "./operator-maintenance"

function sourceTranslation(candidate: SuggestionCandidate) {
  const metadata = useBibleStore
    .getState()
    .translations.find(
      (item) =>
        item.is_downloaded &&
        translationCode(item) === candidate.translation_code
    )
  if (!metadata)
    throw new Error(
      `The ${candidate.translation_code} translation is unavailable.`
    )
  return metadata
}
export async function presentSuggestion(
  candidate: SuggestionCandidate,
  originRevision = operatorRevision()
): Promise<void> {
  if (!isOperatorWorkCurrent(originRevision)) return
  const metadata = sourceTranslation(candidate)
  await presentPrimaryVerse({
    id: 0,
    translation_id: metadata.id,
    book_number: candidate.book_number,
    book_name: candidate.book_name,
    book_abbreviation: "",
    chapter: candidate.chapter,
    verse: candidate.verse,
    text: candidate.verse_text,
  })
}
export async function queueSuggestion(
  candidate: SuggestionCandidate,
  originRevision = operatorRevision()
): Promise<boolean> {
  if (!isOperatorWorkCurrent(originRevision)) return false
  const metadata = sourceTranslation(candidate)
  const verse = await invoke<Verse | null>("get_verse", {
    translationId: metadata.id,
    bookNumber: candidate.book_number,
    chapter: candidate.chapter,
    verse: candidate.verse,
  }).catch((error: unknown) => {
    if (!isOperatorWorkCurrent(originRevision)) return null
    throw error
  })
  if (!isOperatorWorkCurrent(originRevision)) return false
  if (
    !verse ||
    verse.translation_id !== metadata.id ||
    verse.book_number !== candidate.book_number ||
    verse.chapter !== candidate.chapter ||
    verse.verse !== candidate.verse ||
    !verse.text.trim() ||
    sourceTranslation(candidate).id !== metadata.id
  )
    throw new Error(
      `Could not verify ${candidate.translation_code} ${candidate.verse_ref}.`
    )
  const queue = useQueueStore.getState()
  const duplicate = queue.findDuplicate(
    verse.book_number,
    verse.chapter,
    verse.verse
  )
  if (duplicate !== -1) {
    queue.flashItem(queue.items[duplicate].id)
    toast.info(`${candidate.verse_ref} is already queued.`)
    return false
  }
  queue.addItem({
    id: crypto.randomUUID(),
    verse,
    reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
    translation_code: candidate.translation_code,
    confidence: candidate.confidence,
    source: candidate.source === "direct" ? "ai-direct" : "ai-semantic",
    added_at: Date.now(),
  })
  return true
}
