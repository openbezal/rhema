import type { DetectionResult, Translation, Verse } from "@/types"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useQueueStore } from "@/stores/queue-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { normalizeTheme } from "./theme-migrations"
import {
  displayVerseReference,
  type BookDisplayOverride,
} from "./book-display-names"
import {
  SessionArchiveSchema,
  SessionDocumentSchema,
  PortablePreferencesSchema,
  PreferencesDocumentSchema,
  type SessionArchive,
  type SessionDocument,
} from "./session-archive-schema"

export type { SessionArchive, SessionDocument } from "./session-archive-schema"
const MAX_BYTES = 64 * 1024 * 1024
const TranscriptSnapshotSchema = SessionArchiveSchema.pick({
  title: true,
  createdAt: true,
  transcript: true,
})

export function captureTranscriptSnapshot(
  title: string,
  createdAt = Date.now()
) {
  return TranscriptSnapshotSchema.parse({
    title,
    createdAt,
    transcript: useTranscriptStore
      .getState()
      .segments.filter((segment) => segment.is_final)
      .map(({ text, timestamp, confidence }) => ({
        text,
        timestamp,
        confidence,
      })),
  })
}

export function capturePreferencesDocument(createdAt = Date.now()) {
  const bible = useBibleStore.getState()
  const broadcast = useBroadcastStore.getState()
  const settings = useSettingsStore.getState()
  return PreferencesDocumentSchema.parse({
    kind: "rhema-preferences",
    version: 1,
    createdAt,
    preferences: PortablePreferencesSchema.parse({
      settings: {
        gain: settings.gain,
        autoMode: settings.autoMode,
        confidenceThreshold: settings.confidenceThreshold,
        cooldownMs: settings.cooldownMs,
        suggestionCapacity: settings.suggestionCapacity,
        suggestionRetentionMs: settings.suggestionRetentionMs,
        sttProvider: settings.sttProvider,
        bookDisplayOverrides: settings.bookDisplayOverrides,
      },
      primaryTranslationCode: bible.activeTranslationCode,
      secondaryTranslationCode: bible.secondaryTranslationCode,
      followDetections: bible.followDetections,
      autoLive: broadcast.autoLive,
      customThemes: broadcast.themes
        .filter((theme) => !theme.builtin)
        .map(normalizeTheme),
    }),
  })
}

function sourceCode(
  code: string | null | undefined,
  id: number | null | undefined,
  translations: Translation[]
): string | null {
  const normalized = code?.trim().toUpperCase()
  if (normalized && normalized !== "UNKNOWN") return normalized
  const metadata = translations.find((item) => item.id === id)
  return metadata?.abbreviation.trim().toUpperCase() ?? null
}
function archivedVerse(
  verse: Verse,
  code: string | null | undefined,
  translations: Translation[]
) {
  return {
    bookNumber: verse.book_number,
    bookName: verse.book_name,
    chapter: verse.chapter,
    verse: verse.verse,
    text: verse.text,
    translationCode: sourceCode(code, verse.translation_id, translations),
  }
}
function archivedDetection(
  detection: DetectionResult,
  translations: Translation[],
  bookNames: readonly BookDisplayOverride[]
) {
  return {
    reference: displayVerseReference(
      detection,
      sourceCode(
        detection.translation_code,
        detection.translation_id,
        translations
      ),
      bookNames,
      detection.is_chapter_only
    ),
    verse: {
      bookNumber: detection.book_number,
      bookName: detection.book_name,
      chapter: detection.chapter,
      verse: detection.verse,
      text: detection.verse_text,
      translationCode: sourceCode(
        detection.translation_code,
        detection.translation_id,
        translations
      ),
    },
    confidence: detection.confidence,
    source: detection.source,
    scoreKind: detection.score_kind ?? "unknown",
    autoQueued: detection.auto_queued,
    transcriptSnippet: detection.transcript_snippet,
    isChapterOnly: detection.is_chapter_only,
  }
}

/** Capture and validate before any dialog await; never serialize a whole store. */
export function captureSessionArchive(
  title = "Current session",
  createdAt = Date.now()
): SessionArchive {
  const bible = useBibleStore.getState()
  const detection = useDetectionStore.getState()
  const bookNames = useSettingsStore.getState().bookDisplayOverrides
  return SessionArchiveSchema.parse({
    kind: "rhema-session-archive",
    version: 1,
    ...captureTranscriptSnapshot(title, createdAt),
    queue: useQueueStore.getState().items.map((item) => ({
      reference: displayVerseReference(
        item.verse,
        sourceCode(
          item.translation_code,
          item.verse.translation_id,
          bible.translations
        ),
        bookNames,
        item.is_chapter_only,
        item.reference
      ),
      verse: archivedVerse(
        item.verse,
        item.translation_code,
        bible.translations
      ),
      confidence: item.confidence,
      source: item.source,
      addedAt: item.added_at,
      isChapterOnly: item.is_chapter_only ?? false,
    })),
    detectionScope: "current-snapshot",
    detections: detection.detections.map((item) =>
      archivedDetection(item, bible.translations, bookNames)
    ),
    suggestions: detection.suggestions.map((item) => ({
      ...archivedDetection(item, bible.translations, bookNames),
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
    })),
    preferences: capturePreferencesDocument(createdAt).preferences,
  })
}

export function preferencesDocument(archive: SessionArchive) {
  return {
    kind: "rhema-preferences" as const,
    version: 1 as const,
    createdAt: archive.createdAt,
    preferences: archive.preferences,
  }
}

/** Parse into a detached reference document; no active-store mutation occurs. */
export function parseSessionDocument(text: string): SessionDocument {
  if (
    text.length > MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_BYTES
  )
    throw new Error("Document exceeds the 64 MiB limit")
  return SessionDocumentSchema.parse(JSON.parse(text.replace(/^\uFEFF/, "")))
}

export function transcriptDocumentText(
  archive: Pick<SessionArchive, "title" | "createdAt" | "transcript">
): string {
  const heading = `${archive.title}\nExported ${new Date(archive.createdAt).toISOString()}\n\n`
  return (
    heading +
    archive.transcript
      .map(
        (segment) =>
          `[${new Date(segment.timestamp).toISOString()}] ${segment.text}\n`
      )
      .join("\n")
  )
}
