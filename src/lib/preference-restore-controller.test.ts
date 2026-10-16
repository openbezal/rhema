// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
import { defaultNdiSettings } from "@/types"
import type { ResolvedPreferencesRestore } from "./preference-restore"
const native = vi.hoisted(() => ({ invoke: vi.fn(), outputPending: false }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("./output-safety", () => ({
  hasPendingOutputChanges: () => native.outputPending,
}))
type Sections = Record<
  "settings" | "bible" | "broadcast",
  Record<string, unknown>
>
type Profile = { version: number; revision: number; sections: Sections }
const portable = {
  settings: {
    gain: 1.8,
    autoMode: false,
    confidenceThreshold: 0.85,
    cooldownMs: 2000,
    suggestionCapacity: 40,
    suggestionRetentionMs: 90000,
    sttProvider: "whisper" as const,
  },
  primaryTranslationCode: "BIUO",
  secondaryTranslationCode: null,
  followDetections: true,
  autoLive: true,
  customThemes: [
    {
      ...BUILTIN_THEMES[0],
      id: "source-theme",
      name: "Imported Chineke",
      builtin: false,
    },
  ],
}
const translations = [
  {
    id: 7,
    abbreviation: "KJV",
    title: "King James",
    language: "en",
    is_downloaded: true,
    is_copyrighted: false,
  },
  {
    id: 10,
    abbreviation: "BIUO",
    title: "Igbo",
    language: "ig",
    is_downloaded: true,
    is_copyrighted: true,
  },
]
let profile: Profile
let beforeApply: Profile | null
let snapshotAtApply: string | null
let mode: "apply" | "reject" | "lost"
let activeId: number
let stopBible: (() => void) | undefined
beforeEach(() => {
  sessionStorage.clear()
  vi.resetModules()
  vi.useFakeTimers()
  native.invoke.mockReset()
  native.outputPending = false
  mode = "apply"
  activeId = 7
  beforeApply = null
  snapshotAtApply = "not called"
  profile = {
    version: 1,
    revision: 0,
    sections: {
      settings: {
        ...portable.settings,
        gain: 1,
        deepgramApiKey: "FAKE-LOCAL",
        audioDeviceId: "local-device",
        onboardingComplete: true,
      },
      bible: {
        translationSelection: {
          version: 1,
          code: "KJV",
          catalog: { KJV: 7, BIUO: 10 },
        },
        followDetections: false,
      },
      broadcast: {
        customThemes: [
          {
            ...BUILTIN_THEMES[0],
            id: "local",
            name: "Local theme",
            builtin: false,
          },
        ],
        outputs: [
          {
            id: "main",
            name: "Main",
            type: "display",
            themeId: "local",
            monitorIndex: 2,
            ndi: defaultNdiSettings(),
          },
        ],
        activeThemeId: "local",
        autoLive: false,
      },
    },
  }
  native.invoke.mockImplementation(
    async (
      command: string,
      args: {
        expectedRevision: number
        updates: Partial<Sections>
        preferences: ResolvedPreferencesRestore
        translationId: number
      }
    ) => {
      if (command === "read_local_profile") return structuredClone(profile)
      if (command === "read_bible_preferences")
        return structuredClone(profile.sections.bible)
      if (command === "list_translations") return translations
      if (command === "set_active_translation") {
        activeId = args.translationId
        return activeId
      }
      if (command === "write_local_profile") {
        expect(args.expectedRevision).toBe(profile.revision)
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
      if (command === "apply_portable_preferences") {
        snapshotAtApply = sessionStorage.getItem("rhema.broadcast-session.v1")
        expect(args.expectedRevision).toBe(profile.revision)
        beforeApply = structuredClone(profile)
        if (mode === "reject")
          return { status: "rejected", message: "Synthetic disk full" }
        const input = args.preferences
        profile = {
          ...profile,
          revision: profile.revision + 1,
          sections: {
            settings: { ...profile.sections.settings, ...input.settings },
            bible: {
              ...profile.sections.bible,
              translationSelection: {
                version: 1,
                code: input.primaryTranslationCode,
                catalog: { KJV: 7, BIUO: 10 },
              },
              followDetections: input.followDetections,
            },
            broadcast: {
              ...profile.sections.broadcast,
              customThemes: [
                ...(profile.sections.broadcast.customThemes as unknown[]),
                ...input.customThemes,
              ],
              autoLive: input.autoLive,
            },
          },
        }
        activeId = input.primaryTranslationCode === "KJV" ? 7 : 10
        if (mode === "lost") throw new Error("Synthetic lost acknowledgement")
        return {
          status: "applied",
          receipt: {
            profile: structuredClone(profile),
            primary_translation_id: activeId,
            primary_translation_code: input.primaryTranslationCode,
            secondary_translation_code: input.secondaryTranslationCode,
          },
        }
      }
    }
  )
})
afterEach(() => {
  stopBible?.()
  stopBible = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})
async function boot() {
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  const { useTranscriptStore } = await import("@/stores/transcript-store")
  const { useQueueStore } = await import("@/stores/queue-store")
  const maintenance = await import("./operator-maintenance")
  const profileStatus = await import("./profile-status")
  const controller = await import("./preference-restore-controller")
  const { stagePreferencesRestore } = await import("./preference-restore")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
  ])
  stopBible = await bible.initBiblePersistence()
  const held = {
    reference: "Held John 3:16 (KJV)",
    segments: [{ text: "Retained frame" }],
  }
  broadcast.useBroadcastStore.setState({
    isLive: false,
    liveVerse: held,
    presentationRecovery: "ready",
    isDesignerOpen: false,
  })
  useTranscriptStore.setState({
    segments: [
      {
        id: "held",
        text: "Keep the transcript",
        is_final: true,
        timestamp: Date.now(),
        confidence: 1,
        words: [],
      },
    ],
    isTranscribing: false,
    connectionStatus: "disconnected",
  })
  useQueueStore.setState({
    items: [
      {
        id: "held-queue",
        reference: "John 3:16",
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
        translation_code: "KJV",
        verse: {
          id: 716,
          translation_id: 7,
          book_number: 43,
          book_name: "John",
          book_abbreviation: "Jn",
          chapter: 3,
          verse: 16,
          text: "Held Queue text",
        },
      },
    ],
    activeIndex: 0,
  })
  const stage = stagePreferencesRestore(
    portable,
    translations,
    broadcast.useBroadcastStore.getState().themes,
    () => "new"
  )
  return {
    ...settings,
    ...bible,
    ...broadcast,
    useTranscriptStore,
    useQueueStore,
    ...maintenance,
    ...profileStatus,
    ...controller,
    stage,
    held,
  }
}

it("flushes local edits then publishes imported preferences without resetting session or output bindings", async () => {
  const m = await boot()
  const outputs = m.useBroadcastStore.getState().outputs
  const transcript = m.useTranscriptStore.getState().segments
  const queue = m.useQueueStore.getState().items
  m.useSettingsStore.getState().setDeepgramApiKey("FAKE-NEW-LOCAL")
  await m.applyPreferencesRestore(m.stage, "BIUO", null)
  expect(m.useSettingsStore.getState()).toMatchObject({
    gain: 1.8,
    deepgramApiKey: "FAKE-NEW-LOCAL",
    audioDeviceId: "local-device",
    onboardingComplete: true,
  })
  expect(m.useBibleStore.getState()).toMatchObject({
    activeTranslationCode: "BIUO",
    activeTranslationId: 10,
    followDetections: true,
  })
  expect(m.useBroadcastStore.getState()).toMatchObject({
    outputs,
    activeThemeId: "local",
    autoLive: true,
    liveVerse: m.held,
  })
  expect(m.useBroadcastStore.getState().themes).toContainEqual(
    expect.objectContaining({ id: "import-new", name: "Imported Chineke" })
  )
  expect(m.useTranscriptStore.getState().segments).toBe(transcript)
  expect(m.useQueueStore.getState().items).toBe(queue)
  expect(m.useQueueStore.getState().activeIndex).toBe(0)
  expect(activeId).toBe(10)
  expect(snapshotAtApply).toBeNull()
  expect(profile.sections.settings.deepgramApiKey).toBe("FAKE-NEW-LOCAL")
  expect(m.isOperatorMaintenanceActive()).toBe(false)
  const writes = native.invoke.mock.calls.length
  await vi.advanceTimersByTimeAsync(2000)
  expect(native.invoke).toHaveBeenCalledTimes(writes)
})

it("releases maintenance after an acknowledged rejection without applying imported values", async () => {
  const m = await boot()
  mode = "reject"
  await expect(
    m.applyPreferencesRestore(m.stage, "BIUO", null)
  ).rejects.toThrow("disk full")
  expect(profile).toEqual(beforeApply)
  expect(activeId).toBe(7)
  expect(sessionStorage.getItem("rhema.broadcast-session.v1")).not.toBeNull()
  expect(m.useSettingsStore.getState().gain).toBe(1)
  expect(m.useBibleStore.getState().activeTranslationCode).toBe("KJV")
  expect(m.useBroadcastStore.getState().liveVerse).toEqual(m.held)
  expect(
    m.useBroadcastStore
      .getState()
      .themes.some((theme) => theme.id === "import-new")
  ).toBe(false)
  expect(m.isOperatorMaintenanceActive()).toBe(false)
  expect(sessionStorage.getItem("rhema.broadcast-session.v1")).not.toBeNull()
})

it("keeps recovery blocked when the native commit succeeds but its acknowledgement is lost", async () => {
  const m = await boot()
  const { readBroadcastSession } = await import("./broadcast-session-snapshot")
  expect(readBroadcastSession()).not.toBeNull()
  mode = "lost"
  await expect(
    m.applyPreferencesRestore(m.stage, "BIUO", null)
  ).rejects.toThrow("Reload")
  expect(activeId).toBe(10)
  expect(m.useBibleStore.getState().activeTranslationCode).toBe("KJV")
  expect(m.useOperatorMaintenanceStore.getState().phase).toBe("recovery")
  expect(m.useBroadcastStore.getState().liveVerse).toEqual(m.held)
  expect(readBroadcastSession()).toBeNull()
  m.useBroadcastStore
    .getState()
    .setOutputStatus("main", { previewOpen: false, ndiActive: false })
  expect(readBroadcastSession()).toBeNull()
  const writes = native.invoke.mock.calls.length
  await vi.advanceTimersByTimeAsync(2000)
  expect(native.invoke).toHaveBeenCalledTimes(writes)
})

it.each([
  "transcribing",
  "connecting",
  "live",
  "designer",
  "profile",
  "output",
  "translation",
])("refuses %s before flushing or entering native restore", async (reason) => {
  const m = await boot()
  if (reason === "transcribing")
    m.useTranscriptStore.setState({ isTranscribing: true })
  if (reason === "connecting")
    m.useTranscriptStore.setState({ connectionStatus: "connecting" })
  if (reason === "live") m.useBroadcastStore.setState({ isLive: true })
  if (reason === "designer")
    m.useBroadcastStore.setState({ isDesignerOpen: true })
  if (reason === "profile")
    m.useProfileStatusStore.setState({ readFailed: true })
  if (reason === "output") native.outputPending = true
  if (reason === "translation")
    m.useBibleStore.setState({ pendingTranslationChanges: 1 })
  native.invoke.mockClear()
  expect(m.preferenceRestoreBlockedReason()).toBeTruthy()
  await expect(
    m.applyPreferencesRestore(m.stage, "BIUO", null)
  ).rejects.toThrow()
  expect(native.invoke).not.toHaveBeenCalled()
  expect(m.isOperatorMaintenanceActive()).toBe(false)
})
