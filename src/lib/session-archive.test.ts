import { beforeEach, expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import {
  captureSessionArchive,
  parseSessionDocument,
  preferencesDocument,
  transcriptDocumentText,
} from "./session-archive"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useBibleStore } from "@/stores/bible-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { BUILTIN_THEMES } from "./builtin-themes"

const source = {
  id: 42,
  translation_id: 7,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Ọlọ́run — Chineke — Allah",
}
beforeEach(() => {
  useTranscriptStore.setState({
    segments: [],
    currentPartial: "Never export this partial",
  })
  useQueueStore.getState().clearQueue()
  useDetectionStore.getState().clearDetections()
  useBibleStore.setState({
    activeTranslationId: 7,
    activeTranslationCode: "BIUO",
    secondaryTranslationCode: "BSRK",
    followDetections: true,
    translations: [
      {
        id: 7,
        abbreviation: "BIUO",
        title: "Igbo",
        language: "ig",
        is_downloaded: true,
        is_copyrighted: true,
      },
    ],
  })
  useSettingsStore.setState({
    deepgramApiKey: "SECRET-DG",
    openaiApiKey: "SECRET-OA",
    claudeApiKey: "SECRET-CL",
    audioDeviceId: "machine-only",
    onboardingComplete: true,
    gain: 1,
    autoMode: false,
    confidenceThreshold: 0.8,
    cooldownMs: 2500,
    suggestionCapacity: 25,
    suggestionRetentionMs: 60_000,
    sttProvider: "deepgram",
  })
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES],
    isLive: true,
    liveSourceVerse: source,
    liveVerse: { reference: "John 3:16", segments: [{ text: source.text }] },
    autoLive: true,
  })
})

it("round-trips Unicode and exports only final transcript segments", () => {
  useTranscriptStore.setState({
    segments: [
      {
        id: "final",
        text: source.text,
        is_final: true,
        timestamp: 1000,
        confidence: 0.9,
        words: [],
      },
      {
        id: "partial",
        text: "unfinished",
        is_final: false,
        timestamp: 2000,
        confidence: 0.2,
        words: [],
      },
    ],
  })
  const archive = captureSessionArchive("Sunday Ọlọ́run", 3000)
  expect(parseSessionDocument(JSON.stringify(archive))).toEqual(archive)
  expect(archive.transcript).toEqual([
    { text: source.text, timestamp: 1000, confidence: 0.9 },
  ])
  expect(transcriptDocumentText(archive)).toBe(
    "Sunday Ọlọ́run\nExported 1970-01-01T00:00:03.000Z\n\n[1970-01-01T00:00:01.000Z] Ọlọ́run — Chineke — Allah\n"
  )
})

it.each([true, false])(
  "keeps the independent reference verse number choice=%s in both portable JSON documents",
  (includeVerseNumbers) => {
    const theme = {
      ...BUILTIN_THEMES[0],
      id: "custom-reference",
      builtin: false,
      reference: { ...BUILTIN_THEMES[0].reference, includeVerseNumbers },
    }
    useBroadcastStore.setState({ themes: [...BUILTIN_THEMES, theme] })
    const archive = captureSessionArchive("Reference", 3000)
    for (const document of [archive, preferencesDocument(archive)]) {
      const parsed = parseSessionDocument(JSON.stringify(document))
      expect(
        parsed.preferences.customThemes[0].reference.includeVerseNumbers
      ).toBe(includeVerseNumbers)
      expect(parsed.preferences.customThemes[0].verseNumbers).toEqual(
        theme.verseNumbers
      )
    }
  }
)

it("exports portable preferences without keys, device identities or runtime state", () => {
  const json = JSON.stringify(
    preferencesDocument(captureSessionArchive("Settings", 3000))
  )
  for (const excluded of [
    "SECRET-DG",
    "SECRET-OA",
    "SECRET-CL",
    "machine-only",
    "audioDeviceId",
    "monitorIndex",
    "isLive",
    "onboardingComplete",
    "currentPartial",
  ])
    expect(json).not.toContain(excluded)
  const document = parseSessionDocument(json)
  expect(document.kind).toBe("rhema-preferences")
  expect(document.preferences).toMatchObject({
    primaryTranslationCode: "BIUO",
    secondaryTranslationCode: "BSRK",
    followDetections: true,
    autoLive: true,
    settings: { gain: 1, sttProvider: "deepgram" },
  })
})

it("preserves Queue stable source codes instead of persisting numeric database IDs", () => {
  useQueueStore.getState().addItem({
    id: "queue",
    verse: source,
    reference: "John 3:16",
    translation_code: "KJV",
    confidence: 1,
    source: "manual",
    added_at: 1000,
  })
  const archive = captureSessionArchive("Queue", 3000)
  expect(archive.queue[0].verse).toEqual({
    bookNumber: 43,
    bookName: "John",
    chapter: 3,
    verse: 16,
    text: source.text,
    translationCode: "KJV",
  })
  expect(JSON.stringify(archive.queue)).not.toContain("translation_id")
  expect(JSON.stringify(archive.queue)).not.toContain('"id":')
})

it("retains unknown attribution without guessing the active translation", () => {
  useQueueStore.getState().addItem({
    id: "unknown",
    verse: { ...source, translation_id: 999 },
    reference: "John 3:16",
    confidence: 0.7,
    source: "ai-semantic",
    added_at: 1000,
  })
  expect(
    captureSessionArchive("Unknown", 3000).queue[0].verse.translationCode
  ).toBeNull()
})

it.each(["unknown", " UNKNOWN ", " "])(
  "treats %s source tags as unavailable",
  (translation_code) => {
    useQueueStore.getState().addItem({
      id: "unknown",
      verse: { ...source, translation_id: 999 },
      translation_code,
      reference: "John 3:16",
      confidence: 0.7,
      source: "ai-semantic",
      added_at: 1000,
    })
    expect(
      captureSessionArchive("Unknown", 3000).queue[0].verse.translationCode
    ).toBeNull()
  }
)

it.each(BUILTIN_THEMES)(
  "exports a saved custom copy of $name without changing its background",
  (base) => {
    useBroadcastStore.setState({
      themes: [{ ...base, builtin: false, id: "custom" }],
    })
    const archived = captureSessionArchive("Themes", 3000).preferences
      .customThemes[0]
    expect(archived.background).toEqual(base.background)
    expect(archived.verseText.fontSize).toBe(base.verseText.fontSize)
  }
)

it("strips injected credentials from imported preferences before re-export", () => {
  const archive = captureSessionArchive("Imported", 3000)
  const imported = parseSessionDocument(
    JSON.stringify({
      ...archive,
      apiKey: "ROOT-SECRET",
      preferences: {
        ...archive.preferences,
        audioDeviceId: "LOCAL-DEVICE",
        settings: {
          ...archive.preferences.settings,
          deepgramApiKey: "PREF-SECRET",
        },
      },
    })
  )
  expect(JSON.stringify(imported)).not.toContain("ROOT-SECRET")
  expect(JSON.stringify(imported)).not.toContain("PREF-SECRET")
  expect(JSON.stringify(imported)).not.toContain("LOCAL-DEVICE")
})

it("captures a detached snapshot and strips unknown keys inside custom themes", () => {
  const custom = {
    ...BUILTIN_THEMES[0],
    id: "custom",
    builtin: false,
    name: "Ọlọ́run",
    deepgramApiKey: "NESTED-SECRET",
    layout: {
      ...BUILTIN_THEMES[0].layout,
      padding: { ...BUILTIN_THEMES[0].layout.padding },
      apiKey: "LAYOUT-SECRET",
    },
  }
  useBroadcastStore.setState({ themes: [...BUILTIN_THEMES, custom] })
  const archive = captureSessionArchive("Snapshot", 3000)
  custom.layout.padding.top = 456
  expect(archive.preferences.customThemes[0].layout.padding.top).not.toBe(456)
  expect(JSON.stringify(archive)).not.toContain("NESTED-SECRET")
  expect(JSON.stringify(archive)).not.toContain("LAYOUT-SECRET")
})

it("labels detection retention as a current snapshot and keeps score provenance", () => {
  useDetectionStore.getState().addDetections([
    {
      verse_ref: "John 3:16",
      verse_text: source.text,
      book_name: "John",
      book_number: 43,
      chapter: 3,
      verse: 16,
      confidence: 0.75,
      source: "semantic",
      translation_code: "KJV",
      translation_id: 1,
      score_kind: "fts_rank",
      auto_queued: false,
      transcript_snippet: "quote",
      is_chapter_only: false,
    },
  ])
  const archive = captureSessionArchive("Snapshot", 3000)
  expect(archive.detectionScope).toBe("current-snapshot")
  expect(archive.detections[0]).toMatchObject({
    source: "semantic",
    scoreKind: "fts_rank",
    verse: { translationCode: "KJV" },
  })
  expect(archive.suggestions).toHaveLength(1)
})

it.each([
  [
    "future version",
    (value: Record<string, unknown>) => ({ ...value, version: 99 }),
  ],
  [
    "invalid coordinate",
    (value: Record<string, unknown>) => ({
      ...value,
      queue: [{ verse: { bookNumber: 0 } }],
    }),
  ],
  [
    "malformed transcript",
    (value: Record<string, unknown>) => ({
      ...value,
      transcript: [{ text: 3 }],
    }),
  ],
  [
    "invalid nested theme",
    (value: Record<string, unknown>) => ({
      ...value,
      preferences: {
        ...(value.preferences as object),
        customThemes: [
          {
            ...BUILTIN_THEMES[0],
            builtin: false,
            resolution: { width: -1, height: 1080 },
          },
        ],
      },
    }),
  ],
])("rejects %s before returning any archive", (_label, mutate) => {
  const original = captureSessionArchive("Current", 3000)
  expect(() => parseSessionDocument(JSON.stringify(mutate(original)))).toThrow()
  expect(useBroadcastStore.getState().isLive).toBe(true)
  expect(useBroadcastStore.getState().liveSourceVerse).toEqual(source)
})

it("rejects non-JSON and oversized documents", () => {
  expect(() => parseSessionDocument('{"unfinished":')).toThrow()
  expect(() => parseSessionDocument("x".repeat(64 * 1024 * 1024 + 1))).toThrow(
    /64 MiB/
  )
})

it("accepts an empty current session without inventing transcript or references", () => {
  const archive = captureSessionArchive("Empty", 3000)
  expect(archive.transcript).toEqual([])
  expect(archive.queue).toEqual([])
  expect(archive.detections).toEqual([])
  expect(archive.suggestions).toEqual([])
})
