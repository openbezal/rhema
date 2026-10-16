import { beforeEach, afterEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn(), legacyLoad: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/plugin-store", () => ({ load: native.legacyLoad }))
import { BUILTIN_THEMES } from "./builtin-themes"
import { defaultNdiSettings } from "@/types"

type Sections = Record<
  "settings" | "bible" | "broadcast",
  Record<string, unknown>
>
let persisted: { version: number; revision: number; sections: Sections }
let stopBible: (() => void) | undefined
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  native.invoke.mockReset()
  native.legacyLoad
    .mockReset()
    .mockRejectedValue(
      new Error("Legacy plugin-store access is not the canonical profile")
    )
  persisted = {
    version: 1,
    revision: 0,
    sections: {
      settings: {
        gain: 1.6,
        deepgramApiKey: "FAKE-LOCAL-KEY",
        onboardingComplete: true,
        sttProvider: "whisper",
      },
      bible: {
        translationSelection: {
          version: 1,
          code: "BIUO",
          catalog: { KJV: 7, BIUO: 10 },
        },
      },
      broadcast: {
        customThemes: [
          {
            ...BUILTIN_THEMES[0],
            id: "custom",
            name: "Ọlọ́run",
            builtin: false,
          },
        ],
        outputs: [
          {
            id: "main",
            name: "Main",
            type: "display",
            themeId: "custom",
            monitorIndex: 2,
            ndi: defaultNdiSettings("Rhema Output"),
          },
        ],
        autoLive: false,
      },
    },
  }
  native.invoke.mockImplementation(
    async (
      command: string,
      args: {
        expectedRevision?: number
        updates?: Partial<Sections>
        translationId?: number
      }
    ) => {
      if (command === "read_local_profile") return structuredClone(persisted)
      if (command === "write_local_profile") {
        if (args.expectedRevision !== persisted.revision)
          throw new Error("Stale profile")
        persisted = {
          ...persisted,
          revision: persisted.revision + 1,
          sections: { ...persisted.sections, ...structuredClone(args.updates) },
        }
        return structuredClone(persisted)
      }
      if (command === "read_bible_preferences")
        return structuredClone(persisted.sections.bible)
      if (command === "list_translations")
        return [7, 10].map((id) => ({
          id,
          abbreviation: id === 7 ? "KJV" : "BIUO",
          title: "Fixture",
          language: "en",
          is_downloaded: true,
          is_copyrighted: false,
        }))
      if (command === "set_active_translation") return args.translationId
    }
  )
})
afterEach(() => {
  stopBible?.()
  stopBible = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it("hydrates settings, Bible, broadcast and onboarding from one canonical profile", async () => {
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  const tutorial = await import("@/stores/tutorial-store")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
    tutorial.hydrateOnboardingState(),
  ])
  expect(settings.useSettingsStore.getState()).toMatchObject({
    gain: 1.6,
    deepgramApiKey: "FAKE-LOCAL-KEY",
    onboardingComplete: true,
    sttProvider: "whisper",
  })
  expect(bible.useBibleStore.getState()).toMatchObject({
    activeTranslationCode: "BIUO",
    activeTranslationId: 10,
    translationSelectionStatus: "ready",
  })
  expect(
    broadcast.useBroadcastStore
      .getState()
      .themes.find((theme) => theme.id === "custom")?.name
  ).toBe("Ọlọ́run")
  expect(broadcast.useBroadcastStore.getState().outputs[0]).toMatchObject({
    themeId: "custom",
    monitorIndex: 2,
  })
  expect(native.legacyLoad).not.toHaveBeenCalled()
  expect(
    native.invoke.mock.calls.filter((call) => call[0] === "read_local_profile")
  ).toHaveLength(1)
})

it("persists actual store changes without losing neighboring sections or local keys", async () => {
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  const tutorial = await import("@/stores/tutorial-store")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
  ])
  stopBible = await bible.initBiblePersistence()
  settings.useSettingsStore.getState().setGain(1.7)
  bible.useBibleStore.getState().setActiveTranslation(7)
  broadcast.useBroadcastStore
    .getState()
    .renameTheme("custom", "Renamed Chineke")
  await tutorial.persistOnboardingComplete()
  await vi.advanceTimersByTimeAsync(1200)
  expect(persisted.sections.settings).toMatchObject({
    gain: 1.7,
    deepgramApiKey: "FAKE-LOCAL-KEY",
    onboardingComplete: true,
  })
  expect(persisted.sections.bible.translationSelection).toMatchObject({
    code: "KJV",
  })
  expect(persisted.sections.broadcast.customThemes).toEqual([
    expect.objectContaining({ id: "custom", name: "Renamed Chineke" }),
  ])
  expect(persisted.sections.broadcast.outputs).toEqual([
    expect.objectContaining({ monitorIndex: 2 }),
  ])
  expect(native.legacyLoad).not.toHaveBeenCalled()
})

it("does not replace an unreadable profile with defaults from any store", async () => {
  const healthyNative = native.invoke.getMockImplementation()!
  native.invoke.mockImplementation(async (command, args) => {
    if (
      command === "read_local_profile" ||
      command === "read_bible_preferences"
    )
      throw new Error("Synthetic unreadable profile")
    return healthyNative(command, args)
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  const tutorial = await import("@/stores/tutorial-store")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
    tutorial.hydrateOnboardingState(),
  ])
  stopBible = await bible.initBiblePersistence()
  settings.useSettingsStore.getState().setGain(2)
  bible.useBibleStore.getState().setActiveTranslation(7)
  broadcast.useBroadcastStore.getState().setAutoLive(true)
  await tutorial.persistOnboardingComplete()
  await vi.advanceTimersByTimeAsync(1200)
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "write_local_profile"
    )
  ).toHaveLength(0)
  expect(persisted.revision).toBe(0)
  expect(persisted.sections.settings.gain).toBe(1.6)
  expect(
    (await import("./profile-status")).useProfileStatusStore.getState()
      .readFailed
  ).toBe(true)
})

it("keeps a session-only Bible choice temporary after a transient startup read failure", async () => {
  const healthyNative = native.invoke.getMockImplementation()!
  let failedProfile = false
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "read_local_profile" && !failedProfile) {
      failedProfile = true
      throw new Error("Transient profile read failure")
    }
    if (command === "read_bible_preferences")
      throw new Error("Transient checked read failure")
    return healthyNative(command, args)
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  await Promise.all([settings.hydrateSettings(), bible.hydrateBibleStore()])
  stopBible = await bible.initBiblePersistence()
  bible.useBibleStore.getState().setActiveTranslation(7)
  await vi.advanceTimersByTimeAsync(1200)
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "write_local_profile"
    )
  ).toHaveLength(0)
  expect(persisted.sections.bible.translationSelection).toMatchObject({
    code: "BIUO",
  })
  expect(persisted.revision).toBe(0)
})

it("warns and keeps the saved choice when only the separate checked Bible read fails", async () => {
  const healthyNative = native.invoke.getMockImplementation()!
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "read_bible_preferences")
      throw new Error("Checked read failure")
    return healthyNative(command, args)
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  await settings.hydrateSettings()
  await bible.hydrateBibleStore()
  expect(
    (await import("./profile-status")).useProfileStatusStore.getState()
      .readFailed
  ).toBe(true)
  stopBible = await bible.initBiblePersistence()
  bible.useBibleStore.getState().setActiveTranslation(7)
  await vi.advanceTimersByTimeAsync(1200)
  expect(persisted.revision).toBe(0)
})

it("rechecks a Bible choice after waiting behind another section in the shared queue", async () => {
  const healthyNative = native.invoke.getMockImplementation()!
  let release!: () => void
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "write_local_profile" && args.updates?.settings)
      await new Promise<void>((resolve) => {
        release = resolve
      })
    return healthyNative(command, args)
  })
  const bible = await import("@/stores/bible-store")
  await bible.hydrateBibleStore()
  stopBible = await bible.initBiblePersistence()
  const { openProfileSection } = await import("./profile-persistence")
  const settings = await openProfileSection("settings")
  await settings.set("gain", 1.7)
  const held = settings.save()
  await vi.advanceTimersByTimeAsync(0)
  bible.useBibleStore.getState().setActiveTranslation(7)
  await vi.advanceTimersByTimeAsync(500)
  bible.useBibleStore
    .getState()
    .setTranslations(
      bible.useBibleStore
        .getState()
        .translations.filter((item) => item.id !== 7)
    )
  expect(bible.useBibleStore.getState().translationSelectionStatus).toBe(
    "needs_confirmation"
  )
  release()
  await held
  await vi.advanceTimersByTimeAsync(0)
  expect(persisted.sections.settings.gain).toBe(1.7)
  expect(persisted.sections.bible.translationSelection).toMatchObject({
    code: "BIUO",
  })
  expect(persisted.revision).toBe(1)
})

it("flushes pending local keys, output themes and Follow before restore without later timer replays", async () => {
  const settings = await import("@/stores/settings-store")
  const bible = await import("@/stores/bible-store")
  const broadcast = await import("@/stores/broadcast-store")
  await Promise.all([
    settings.hydrateSettings(),
    bible.hydrateBibleStore(),
    broadcast.hydrateBroadcastThemes(),
  ])
  stopBible = await bible.initBiblePersistence()
  settings.useSettingsStore.getState().setDeepgramApiKey("FAKE-NEW-LOCAL")
  broadcast.useBroadcastStore
    .getState()
    .renameTheme("custom", "Fresh local theme")
  bible.useBibleStore.getState().setFollowDetections(true)
  await Promise.all([
    settings.flushSettingsPersistence(),
    broadcast.flushBroadcastPersistence(),
    bible.flushBiblePersistence(),
  ])
  expect(persisted.sections.settings.deepgramApiKey).toBe("FAKE-NEW-LOCAL")
  expect(persisted.sections.broadcast.customThemes).toEqual([
    expect.objectContaining({ name: "Fresh local theme" }),
  ])
  expect(persisted.sections.bible.followDetections).toBe(true)
  const writes = native.invoke.mock.calls.filter(
    ([command]) => command === "write_local_profile"
  ).length
  await vi.advanceTimersByTimeAsync(2000)
  expect(
    native.invoke.mock.calls.filter(
      ([command]) => command === "write_local_profile"
    )
  ).toHaveLength(writes)
})

it("reports a failed local settings flush and permits a real retry without losing the pending key", async () => {
  const settings = await import("@/stores/settings-store")
  await settings.hydrateSettings()
  settings.useSettingsStore.getState().setDeepgramApiKey("FAKE-NEW-LOCAL")
  const healthyNative = native.invoke.getMockImplementation()!
  let fail = true
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "write_local_profile" && fail) {
      fail = false
      throw new Error("Synthetic disk full")
    }
    return healthyNative(command, args)
  })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  await expect(settings.flushSettingsPersistence()).rejects.toThrow("disk full")
  expect(persisted.sections.settings.deepgramApiKey).toBe("FAKE-LOCAL-KEY")
  await settings.flushSettingsPersistence()
  expect(persisted.sections.settings.deepgramApiKey).toBe("FAKE-NEW-LOCAL")
})

it("hydrates Follow from the canonical Bible section and persists a changed value", async () => {
  persisted.sections.bible.followDetections = true
  const bible = await import("@/stores/bible-store")
  await bible.hydrateBibleStore()
  expect(bible.useBibleStore.getState().followDetections).toBe(true)
  stopBible = await bible.initBiblePersistence()
  bible.useBibleStore.getState().setFollowDetections(false)
  await vi.advanceTimersByTimeAsync(500)
  expect(persisted.sections.bible.followDetections).toBe(false)
})

it.each(["settings", "broadcast"])(
  "refuses a %s flush whose initial hydration fails instead of retrying with defaults",
  async (section) => {
    const healthyNative = native.invoke.getMockImplementation()!
    let failed = false
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "read_local_profile" && !failed) {
        failed = true
        throw new Error("Synthetic transient read failure")
      }
      return healthyNative(command, args)
    })
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const flush =
      section === "settings"
        ? (await import("@/stores/settings-store")).flushSettingsPersistence
        : (await import("@/stores/broadcast-store")).flushBroadcastPersistence
    await expect(flush()).rejects.toThrow("Restart")
    expect(
      native.invoke.mock.calls.filter(
        ([command]) => command === "write_local_profile"
      )
    ).toHaveLength(0)
    expect(persisted.revision).toBe(0)
    expect(persisted.sections.settings.deepgramApiKey).toBe("FAKE-LOCAL-KEY")
  }
)
