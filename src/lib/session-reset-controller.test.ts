// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Book } from "@/types"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  outputPending: false,
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: native.emit,
  listen: vi.fn(
    async (event: string, handler: (event: { payload: unknown }) => void) => {
      const handlers = native.listeners.get(event) ?? new Set()
      handlers.add(handler)
      native.listeners.set(event, handlers)
      return () => {
        handlers.delete(handler)
      }
    }
  ),
}))
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}))
vi.mock("@/components/layout/dashboard", () => ({ Dashboard: () => null }))
vi.mock("@/components/controls/operator-shortcut-overlays", () => ({
  OperatorShortcutOverlays: () => null,
}))
vi.mock("@/components/tutorial/tutorial-overlay", () => ({
  TutorialOverlay: () => null,
}))
vi.mock("@/components/translation-selection-dialog", () => ({
  TranslationSelectionDialog: () => null,
}))
vi.mock("./output-safety", () => ({
  hasPendingOutputChanges: () => native.outputPending,
}))
let mode: "reset" | "reject" | "stale" | "lost" | "malformed" | "delay"
let revision: number, snapshotAtReset: string | null, resetCalls: number
let finishReset: (() => void) | undefined
let stopBible: (() => void) | undefined
const translations = [
  {
    id: 1,
    abbreviation: "KJV",
    title: "KJV",
    language: "en",
    is_downloaded: true,
    is_copyrighted: false,
  },
]
const books: Book[] = [1, 43].map((n) => ({
  id: n,
  translation_id: 1,
  book_number: n,
  name: n === 1 ? "Genesis" : "John",
  abbreviation: n === 1 ? "Gen" : "Jn",
  testament: n === 1 ? "OT" : "NT",
}))
const verse = (book = 43, chapter = 3, v = 16) => ({
  id: book * 1000 + chapter * 100 + v,
  translation_id: 1,
  book_number: book,
  book_name: book === 1 ? "Genesis" : "John",
  book_abbreviation: book === 1 ? "Gen" : "Jn",
  chapter,
  verse: v,
  text: "Retained canonical source text",
})
let profile: {
  version: number
  revision: number
  sections: Record<string, Record<string, unknown>>
}
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers()
  sessionStorage.clear()
  native.invoke.mockReset()
  native.emit.mockReset().mockResolvedValue(undefined)
  native.outputPending = false
  native.listeners.clear()
  mode = "reset"
  revision = 0
  snapshotAtReset = "not called"
  resetCalls = 0
  finishReset = undefined
  profile = {
    version: 1,
    revision: 0,
    sections: {
      settings: {
        gain: 1.6,
        sttProvider: "whisper",
        deepgramApiKey: "FAKE-LOCAL-ONLY",
        audioDeviceId: "local-microphone",
        onboardingComplete: true,
        unknownLocal: "keep",
      },
      bible: {
        translationSelection: { version: 1, code: "KJV", catalog: { KJV: 1 } },
        followDetections: true,
      },
      broadcast: { customThemes: [], autoLive: true },
    },
  }
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "read_local_profile") return structuredClone(profile)
    if (command === "read_bible_preferences")
      return structuredClone(profile.sections.bible)
    if (command === "list_translations") return translations
    if (command === "list_books") return books
    if (command === "get_chapter")
      return [verse(args.bookNumber, args.chapter, args.verse ?? 1)]
    if (command === "get_verse")
      return verse(args.bookNumber, args.chapter, args.verse)
    if (command === "read_operator_session_revision") return revision
    if (command === "write_local_profile") {
      profile = {
        ...profile,
        revision: profile.revision + 1,
        sections: { ...profile.sections, ...structuredClone(args.updates) },
      }
      return {
        version: 1,
        revision: profile.revision,
        sections: structuredClone(args.updates),
      }
    }
    if (command === "reset_operator_session") {
      resetCalls++
      snapshotAtReset = sessionStorage.getItem("rhema.broadcast-session.v1")
      expect(args).toEqual({ expectedRevision: 0 })
      if (mode === "reject")
        return {
          status: "rejected",
          revision,
          message: "Stop the audio test before starting a new session.",
        }
      if (mode === "stale")
        return {
          status: "rejected",
          revision: 1,
          message: "The session changed.",
        }
      if (mode === "malformed") return { status: "reset", revision: 9 }
      revision++
      if (mode === "lost")
        throw new Error("Synthetic lost reset acknowledgement")
      if (mode === "delay")
        await new Promise<void>((resolve) => {
          finishReset = resolve
        })
      return { status: "reset", revision }
    }
    return undefined
  })
})
afterEach(() => {
  stopBible?.()
  stopBible = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function setup() {
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  const { useTranscriptStore } = await import("@/stores/transcript-store")
  const { useDetectionStore } = await import("@/stores/detection-store")
  const { useQueueStore } = await import("@/stores/queue-store")
  const { useAudioStore } = await import("@/stores/audio-store")
  const { useOperatorMaintenanceStore } = await import("./operator-maintenance")
  const { useProfileStatusStore } = await import("./profile-status")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
  ])
  stopBible = await bible.initBiblePersistence()
  const selected = verse()
  bible.useBibleStore.setState({
    books,
    currentChapter: [selected],
    selectedVerse: selected,
    semanticResults: [],
    pendingNavigation: null,
  })
  useTranscriptStore.setState({
    segments: [
      {
        id: "final",
        text: "Sunday Ọlọ́run",
        is_final: true,
        confidence: 1,
        words: [],
        timestamp: 1,
      },
    ],
    currentPartial: "unfinished",
    isTranscribing: false,
    connectionStatus: "error",
  })
  useQueueStore.setState({
    items: [
      {
        id: "held",
        verse: selected,
        reference: "John 3:16",
        translation_code: "KJV",
        confidence: 1,
        source: "manual",
        added_at: 1,
      },
    ],
    activeIndex: 0,
    highlightedId: "held",
  })
  const detection = {
    book_number: 43,
    book_name: "John",
    chapter: 3,
    verse: 16,
    verse_ref: "John 3:16",
    verse_text: selected.text,
    translation_id: 1,
    translation_code: "KJV",
    confidence: 0.95,
    source: "direct" as const,
    auto_queued: false,
    transcript_snippet: "John three sixteen",
    is_chapter_only: false,
  }
  useDetectionStore
    .getState()
    .addDetections([
      detection,
      { ...detection, source: "semantic", verse: 17, verse_ref: "John 3:17" },
    ])
  useDetectionStore.setState({
    dismissed: { "direct|Mark 2:5": 999999 },
    dismissedSuggestions: { old: 999999 },
  })
  broadcast.useBroadcastStore.setState({
    isLive: false,
    presentationRecovery: "ready",
    liveVerse: {
      reference: "John 3:16 (KJV)",
      segments: [{ text: selected.text }],
    },
    liveSourceVerse: selected,
    hasExplicitClear: false,
  })
  useAudioStore.setState({ level: { rms: 0.4, peak: 0.8 }, sourceLost: true })
  const reset = await import("./session-reset-controller")
  return {
    ...reset,
    ...settings,
    ...bible,
    ...broadcast,
    useTranscriptStore,
    useDetectionStore,
    useQueueStore,
    useAudioStore,
    useOperatorMaintenanceStore,
    useProfileStatusStore,
    selected,
  }
}
it("clears all runtime histories only after native acknowledgement and preserves saved/local identities", async () => {
  const m = await setup()
  const settings = m.useSettingsStore.getState(),
    outputs = m.useBroadcastStore.getState().outputs,
    themes = m.useBroadcastStore.getState().themes,
    chapter = m.useBibleStore.getState().currentChapter
  expect(sessionStorage.getItem("rhema.broadcast-session.v1")).not.toBeNull()
  await m.startNewSession()
  expect(resetCalls).toBe(1)
  expect(snapshotAtReset).toBeNull()
  expect(m.useTranscriptStore.getState()).toMatchObject({
    segments: [],
    currentPartial: "",
    isTranscribing: false,
    connectionStatus: "disconnected",
  })
  expect(m.useQueueStore.getState()).toMatchObject({
    items: [],
    activeIndex: null,
    highlightedId: null,
  })
  expect(m.useDetectionStore.getState()).toMatchObject({
    detections: [],
    suggestions: [],
    dismissed: {},
    dismissedSuggestions: {},
  })
  expect(m.useBibleStore.getState()).toMatchObject({
    selectedVerse: null,
    pendingNavigation: null,
    semanticResults: [],
    semanticResultSource: null,
    searchResults: [],
    crossReferences: [],
    activeTranslationCode: "KJV",
    followDetections: true,
  })
  expect(m.useBibleStore.getState().currentChapter).toBe(chapter)
  expect(m.useBroadcastStore.getState()).toMatchObject({
    liveVerse: null,
    liveSourceVerse: null,
    liveTrace: null,
    isLive: false,
    clearMode: "background",
    hasExplicitClear: true,
    autoLive: true,
  })
  expect(m.useBroadcastStore.getState().outputs).toBe(outputs)
  expect(m.useBroadcastStore.getState().themes).toBe(themes)
  expect(m.useSettingsStore.getState()).toBe(settings)
  expect(profile.sections.settings).toMatchObject({
    deepgramApiKey: "FAKE-LOCAL-ONLY",
    audioDeviceId: "local-microphone",
    unknownLocal: "keep",
  })
  expect(m.useAudioStore.getState()).toMatchObject({
    level: { rms: 0, peak: 0 },
    sourceLost: false,
  })
  expect(m.useOperatorMaintenanceStore.getState().phase).toBe("idle")
  expect(
    JSON.parse(sessionStorage.getItem("rhema.broadcast-session.v1")!).payload
  ).not.toContain("Retained canonical")
  expect(
    native.emit.mock.calls.some(
      ([target, event, payload]) =>
        target === "broadcast-main" &&
        event === "broadcast:verse-update" &&
        payload.verse === null &&
        payload.clearMode === "background"
    )
  ).toBe(true)
})
it("holds old content and blocks duplicates until the exact reset receipt arrives", async () => {
  mode = "delay"
  const m = await setup(),
    old = m.useTranscriptStore.getState().segments
  const job = m.startNewSession()
  void job.catch(() => {}) // Attach immediately while the delayed-dispatch assertion runs.
  await vi.waitFor(() => expect(finishReset).toBeTypeOf("function"))
  expect(m.useOperatorMaintenanceStore.getState().phase).toBe("committing")
  expect(m.useTranscriptStore.getState().segments).toBe(old)
  await expect(m.startNewSession()).rejects.toThrow()
  expect(resetCalls).toBe(1)
  finishReset!()
  await job
  expect(m.useTranscriptStore.getState().segments).toEqual([])
})
it("retains histories, frame and snapshot after a known unchanged native refusal", async () => {
  mode = "reject"
  const m = await setup(),
    old = m.useTranscriptStore.getState().segments,
    queue = m.useQueueStore.getState().items,
    frame = m.useBroadcastStore.getState().liveVerse
  await expect(m.startNewSession()).rejects.toThrow("audio test")
  expect(m.useTranscriptStore.getState().segments).toBe(old)
  expect(m.useQueueStore.getState().items).toBe(queue)
  expect(m.useBroadcastStore.getState().liveVerse).toBe(frame)
  expect(m.useOperatorMaintenanceStore.getState().phase).toBe("idle")
  expect(sessionStorage.getItem("rhema.broadcast-session.v1")).not.toBeNull()
})
it.each(["lost", "malformed", "stale"] as const)(
  "freezes recovery and retains exportable old UI after %s acknowledgement",
  async (value) => {
    mode = value
    const m = await setup(),
      old = m.useTranscriptStore.getState().segments,
      queue = m.useQueueStore.getState().items
    await expect(m.startNewSession()).rejects.toBeInstanceOf(
      m.UncertainSessionResetError
    )
    expect(m.useOperatorMaintenanceStore.getState().phase).toBe("recovery")
    expect(m.useTranscriptStore.getState().segments).toBe(old)
    expect(m.useQueueStore.getState().items).toBe(queue)
    expect(sessionStorage.getItem("rhema.broadcast-session.v1")).toBeNull()
    await expect(m.startNewSession()).rejects.toThrow()
    expect(resetCalls).toBe(1)
  }
)
it("does not seed Genesis or select any preview when app catalog reconnects after reset", async () => {
  const m = await setup()
  const { connectBibleCatalog } = await import("./bible-catalog"),
    { connectBibleNavigation } = await import("./bible-navigation")
  const stopCatalog = connectBibleCatalog(),
    stopNavigation = connectBibleNavigation()
  try {
    await m.startNewSession()
    await Promise.resolve()
    await Promise.resolve()
    expect(m.useBibleStore.getState().selectedVerse).toBeNull()
    expect(m.useBibleStore.getState().pendingNavigation).toBeNull()
    expect(m.useBibleStore.getState().currentChapter[0].book_number).toBe(43)
  } finally {
    stopCatalog()
    stopNavigation()
  }
})
it("refuses reset when any runtime prerequisite is unsafe", async () => {
  const m = await setup()
  const cases = [
    [
      () => m.useTranscriptStore.setState({ isTranscribing: true }),
      () => m.useTranscriptStore.setState({ isTranscribing: false }),
    ],
    [
      () => m.useTranscriptStore.setState({ connectionStatus: "connecting" }),
      () => m.useTranscriptStore.setState({ connectionStatus: "disconnected" }),
    ],
    [
      () => m.useBroadcastStore.setState({ isLive: true }),
      () => m.useBroadcastStore.setState({ isLive: false }),
    ],
    [
      () => m.useBroadcastStore.setState({ isDesignerOpen: true }),
      () => m.useBroadcastStore.setState({ isDesignerOpen: false }),
    ],
    [
      () => m.useBroadcastStore.setState({ presentationRecovery: "unknown" }),
      () => m.useBroadcastStore.setState({ presentationRecovery: "ready" }),
    ],
    [
      () => m.useAudioStore.setState({ isTesting: true }),
      () => m.useAudioStore.setState({ isTesting: false }),
    ],
    [
      () => m.useAudioStore.setState({ isTestStarting: true }),
      () => m.useAudioStore.setState({ isTestStarting: false }),
    ],
    [
      () => {
        native.outputPending = true
      },
      () => {
        native.outputPending = false
      },
    ],
    [
      () => m.useBibleStore.setState({ pendingTranslationChanges: 1 }),
      () => m.useBibleStore.setState({ pendingTranslationChanges: 0 }),
    ],
    [
      () => m.useProfileStatusStore.setState({ readFailed: true }),
      () => m.useProfileStatusStore.setState({ readFailed: false }),
    ],
  ]
  for (const [block, unblock] of cases) {
    block()
    expect(m.newSessionBlockedReason()).not.toBeNull()
    await expect(m.startNewSession()).rejects.toThrow()
    unblock()
  }
  expect(resetCalls).toBe(0)
})
it("retains an immutable recovery export if store publication fails after native reset", async () => {
  const m = await setup()
  const publish = vi
    .spyOn(m.useBroadcastStore, "setState")
    .mockImplementationOnce(() => {
      throw new Error("Synthetic publication failure")
    })
  try {
    await expect(m.startNewSession()).rejects.toBeInstanceOf(
      m.UncertainSessionResetError
    )
    expect(revision).toBe(1)
    expect(m.useOperatorMaintenanceStore.getState().phase).toBe("recovery")
    const recovered = m.getSessionResetRecoveryArchive()!
    expect(recovered.transcript[0].text).toBe("Sunday Ọlọ́run")
    expect(recovered.queue[0].verse.text).toBe("Retained canonical source text")
    expect(JSON.stringify(recovered)).not.toContain("FAKE-LOCAL-ONLY")
    recovered.transcript.length = 0
    expect(m.getSessionResetRecoveryArchive()!.transcript).toHaveLength(1)
    expect(sessionStorage.getItem("rhema.broadcast-session.v1")).toBeNull()
  } finally {
    publish.mockRestore()
  }
})
it("leaves content and snapshot intact when saving pending preferences fails before native dispatch", async () => {
  const m = await setup(),
    old = m.useTranscriptStore.getState().segments,
    frame = m.useBroadcastStore.getState().liveVerse
  const invoke = native.invoke.getMockImplementation()!
  native.invoke.mockImplementation((command, args) =>
    command === "write_local_profile"
      ? Promise.reject(new Error("Synthetic full disk"))
      : invoke(command, args)
  )
  await expect(m.startNewSession()).rejects.toThrow("Synthetic full disk")
  expect(resetCalls).toBe(0)
  expect(m.useTranscriptStore.getState().segments).toBe(old)
  expect(m.useBroadcastStore.getState().liveVerse).toBe(frame)
  expect(sessionStorage.getItem("rhema.broadcast-session.v1")).not.toBeNull()
  expect(m.useOperatorMaintenanceStore.getState().phase).toBe("idle")
})
it("keeps a new session empty with panels absent despite old App-owned packets and overlapping lookups", async () => {
  const m = await setup(),
    { default: App } = await import("@/App")
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const send = (event: string, payload: unknown, revision: number) => {
    for (const handler of native.listeners.get(`session:${event}`) ?? [])
      handler({ payload: { revision, payload } })
  }
  const pending: Array<() => void> = []
  const invoke = native.invoke.getMockImplementation()!
  try {
    await act(async () => root.render(createElement(App)))
    expect(host.querySelector('[data-slot="search-panel"]')).toBeNull()
    const oldFinal = [...native.listeners.get("session:transcript_final")!][0]
    native.invoke.mockImplementation((command, args) => {
      if (
        command === "get_verse" ||
        command === "get_chapter" ||
        command === "detect_verses"
      )
        return new Promise((resolve) =>
          pending.push(() =>
            resolve(
              command === "detect_verses"
                ? []
                : command === "get_chapter"
                  ? [verse()]
                  : verse()
            )
          )
        )
      return invoke(command, args)
    })
    const { queueSuggestion } = await import("./suggestion-actions"),
      { presentVerse } = await import("./presentation-controller"),
      { detectionActions } = await import("@/hooks/use-detection")
    const candidate = m.useDetectionStore.getState().suggestions[0]
    let oldJobs: Promise<unknown>[] = []
    await act(async () => {
      oldJobs = [
        queueSuggestion(candidate),
        presentVerse(verse()),
        detectionActions.detectVerses("old pending quote"),
      ]
      m.useBibleStore
        .getState()
        .setPendingNavigation({
          bookNumber: 43,
          chapter: 4,
          verse: 16,
          present: true,
        })
    })
    expect(pending.length).toBeGreaterThanOrEqual(4)
    await act(async () => m.startNewSession())
    await act(async () => {
      pending.forEach((finish) => finish())
      await Promise.all(oldJobs)
      oldFinal({
        payload: {
          revision: 0,
          payload: { text: "old retained callback", confidence: 1 },
        },
      })
      send("transcript_final", { text: "old native packet", confidence: 1 }, 0)
      send(
        "verse_detections",
        [{ ...candidate, source: "direct", auto_queued: true }],
        0
      )
      send(
        "reading_mode_verse",
        { ...candidate, reference: candidate.verse_ref },
        0
      )
      send("remote:on_air", { active: true }, 0)
    })
    expect(m.useTranscriptStore.getState().segments).toEqual([])
    expect(m.useDetectionStore.getState().detections).toEqual([])
    expect(m.useDetectionStore.getState().suggestions).toEqual([])
    expect(m.useQueueStore.getState().items).toEqual([])
    expect(m.useBibleStore.getState().selectedVerse).toBeNull()
    expect(m.useBibleStore.getState().pendingNavigation).toBeNull()
    expect(m.useBroadcastStore.getState()).toMatchObject({
      liveVerse: null,
      liveSourceVerse: null,
      isLive: false,
    })
    await act(async () => {
      send(
        "transcript_final",
        { text: "new explicit session", confidence: 1 },
        1
      )
      send("remote:set_auto_broadcast", { active: false }, 1)
    })
    expect(
      m.useTranscriptStore.getState().segments.map((segment) => segment.text)
    ).toEqual(["new explicit session"])
    expect(m.useBroadcastStore.getState().autoLive).toBe(false)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
