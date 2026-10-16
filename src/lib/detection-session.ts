import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { mark } from "./latency-marks"
import { pickAutoPresentTarget } from "./auto-present-target"
import { presentVerse } from "./presentation-controller"
import { useSettingsStore } from "@/stores/settings-store"
import { translationCode } from "./translation-selection"
import { connectOutsideMaintenance } from "./operator-maintenance"
import {
  useAudioStore,
  useTranscriptStore,
  useBibleStore,
  useBroadcastStore,
  useDetectionStore,
  useQueueStore,
} from "@/stores"
import type { DetectionResult, ReadingAdvance, Verse } from "@/types"

interface TranscriptPayload {
  text: string
  confidence: number
}
function candidateVerse(
  data: Pick<
    DetectionResult,
    | "book_number"
    | "book_name"
    | "chapter"
    | "verse"
    | "verse_text"
    | "translation_id"
  >
): Verse {
  return {
    id: 0,
    translation_id:
      data.translation_id ?? useBibleStore.getState().activeTranslationId,
    book_number: data.book_number,
    book_name: data.book_name,
    book_abbreviation: "",
    chapter: data.chapter,
    verse: data.verse,
    text: data.verse_text,
  }
}
function followCandidate(verse: Verse): void {
  const follow = useBibleStore.getState().followDetections
  if (useBroadcastStore.getState().autoLive)
    void presentVerse(verse, { selectPreview: follow, automatic: true })
  if (follow)
    useBibleStore.getState().setPendingNavigation({
      bookNumber: verse.book_number,
      chapter: verse.chapter,
      verse: verse.verse,
      follow: true,
    })
}
function handleDetections(detections: DetectionResult[]): void {
  mark(
    `verse_detections received src=${detections[0]?.source ?? "?"} n=${detections.length} first=${detections[0]?.verse_ref ?? ""}`
  )
  useDetectionStore.getState().addDetections(detections)
  mark(`addDetections done src=${detections[0]?.source ?? "?"}`)

  // Auto-navigate book search + select verse for preview/live. Picks the
  // most confident direct hit and skips operator-dismissed references —
  // see pickAutoPresentTarget for why.
  const directHit = pickAutoPresentTarget(detections, (verseRef) =>
    useDetectionStore.getState().isDismissed(verseRef, "direct")
  )
  if (directHit && directHit.book_number > 0)
    followCandidate(candidateVerse(directHit))

  // Auto-queue high-confidence detections
  for (const d of detections) {
    if (
      !d.translation_code?.trim() ||
      !Number.isSafeInteger(d.translation_id) ||
      (d.translation_id ?? 0) <= 0
    )
      continue
    const attribution = {
      translationId: d.translation_id as number,
      translationCode: d.translation_code.trim().toUpperCase(),
    }
    // Check if this detection refines an existing chapter-only queue item
    if (
      !d.is_chapter_only &&
      d.source === "direct" &&
      useQueueStore
        .getState()
        .updateEarlyRef(
          d.book_number,
          d.chapter,
          d.verse,
          d.verse_ref,
          d.verse_text,
          attribution
        )
    ) {
      continue
    }

    if (d.auto_queued) {
      const queue = useQueueStore.getState()
      // For chapter-only detections, match by book+chapter (any verse) to
      // avoid re-adding "Mark 1:1" when "Mark 1:2" already exists from a
      // previous chapter-only → refinement cycle.
      const dupIdx = d.is_chapter_only
        ? queue.items.findIndex(
            (i) =>
              i.verse.book_number === d.book_number &&
              i.verse.chapter === d.chapter
          )
        : queue.findDuplicate(d.book_number, d.chapter, d.verse)
      if (dupIdx !== -1) {
        const existing = queue.items[dupIdx]
        // Backfill text if the existing item was queued without it
        // (e.g. an earlier detection emitted with empty verse text).
        if (
          existing.verse.translation_id === attribution.translationId &&
          !existing.verse.text &&
          d.verse_text
        ) {
          queue.backfillText(existing.id, d.verse_text)
        }
        queue.flashItem(existing.id)
        if (!d.is_chapter_only) queue.setActive(dupIdx)
        continue
      }
      queue.addItem({
        id: crypto.randomUUID(),
        verse: {
          id: 0,
          translation_id: attribution.translationId,
          book_number: d.book_number,
          book_name: d.book_name,
          book_abbreviation: "",
          chapter: d.chapter,
          verse: d.verse,
          text: d.verse_text,
        },
        reference: d.verse_ref,
        translation_code: attribution.translationCode,
        confidence: d.confidence,
        source: d.source === "direct" ? "ai-direct" : "ai-semantic",
        added_at: Date.now(),
        is_chapter_only: d.is_chapter_only,
      })
    }
  }
}
let leases = 0
let release: (() => void) | null = null
/** One app-owned ingestion boundary, regardless of how many panels consume state. */
export function connectDetectionSession(): () => void {
  return connectOutsideMaintenance(connectActiveDetectionSession)
}
function connectActiveDetectionSession(): () => void {
  if (leases++ === 0) {
    useDetectionStore.getState().pruneSuggestions()
    let cancelled = false
    const unlisteners: UnlistenFn[] = [
      useSettingsStore.subscribe((settings, previous) => {
        if (
          settings.suggestionCapacity !== previous.suggestionCapacity ||
          settings.suggestionRetentionMs !== previous.suggestionRetentionMs
        )
          useDetectionStore.getState().pruneSuggestions()
      }),
    ]
    const on = <T>(event: string, handler: (payload: T) => void) => {
      void listen<T>(event, ({ payload }) => {
        if (!cancelled) handler(payload)
      })
        .then((stop) => {
          if (cancelled) stop()
          else unlisteners.push(stop)
        })
        .catch((error: unknown) => {
          if (!cancelled)
            console.warn(`[session] Could not listen for ${event}:`, error)
        })
    }
    on<{ rms: number; peak: number }>("audio_level", (payload) =>
      useAudioStore.getState().setLevel(payload)
    )
    on("stt_connected", () =>
      useTranscriptStore.getState().setConnectionStatus("connected")
    )
    on("stt_disconnected", () =>
      useTranscriptStore.getState().setConnectionStatus("disconnected")
    )
    on<string>("stt_error", (message) => {
      useTranscriptStore.getState().setConnectionStatus("error")
      toast.error("Transcription error", { description: message })
    })
    on("audio_source_lost", () => {
      useAudioStore.getState().setSourceLost(true)
      toast.warning("Audio source disconnected", {
        description: "Waiting for the device to come back…",
        id: "audio-source-status",
      })
    })
    on("audio_source_recovered", () => {
      useAudioStore.getState().setSourceLost(false)
      toast.success("Audio source reconnected", { id: "audio-source-status" })
    })
    on<TranscriptPayload>("transcript_partial", (payload) => {
      mark(`transcript_partial received "${payload.text.slice(0, 30)}"`)
      useTranscriptStore.getState().setPartial(payload.text)
    })
    on<TranscriptPayload>("transcript_final", (payload) => {
      mark(`transcript_final received "${payload.text.slice(0, 30)}"`)
      useTranscriptStore.getState().addSegment({
        id: crypto.randomUUID(),
        text: payload.text,
        is_final: true,
        confidence: payload.confidence,
        words: [],
        timestamp: Date.now(),
      })
    })
    on<{ abbreviation: string; translation_id: number }>(
      "translation_command",
      (data) => {
        const state = useBibleStore.getState()
        const metadata = state.translations.find(
          (item) => item.id === data.translation_id && item.is_downloaded
        )
        if (
          metadata &&
          translationCode(metadata) === data.abbreviation.trim().toUpperCase()
        )
          state.setActiveTranslation(metadata.id)
      }
    )
    on<DetectionResult[]>("verse_detections", handleDetections)
    on<ReadingAdvance>("reading_mode_verse", (data) => {
      mark(`reading_mode_verse received ${data.reference ?? ""}`)
      if (data.book_number > 0) followCandidate(candidateVerse(data))
    })
    release = () => {
      cancelled = true
      unlisteners.forEach((stop) => stop())
    }
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--leases === 0) {
      release?.()
      release = null
    }
  }
}
