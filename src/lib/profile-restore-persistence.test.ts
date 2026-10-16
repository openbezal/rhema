import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
const initial = {
  version: 1,
  revision: 0,
  sections: {
    settings: { gain: 1, deepgramApiKey: "FAKE-LOCAL" },
    bible: { translationSelection: { version: 1, code: "BIUO" } },
    broadcast: { customThemes: [], outputs: [{ id: "main", monitorIndex: 2 }] },
  },
}
const preferences = {
  settings: {
    gain: 2,
    autoMode: false,
    confidenceThreshold: 0.8,
    cooldownMs: 2500,
    suggestionCapacity: 25,
    suggestionRetentionMs: 60000,
    sttProvider: "whisper" as const,
  },
  primaryTranslationCode: "KJV",
  secondaryTranslationCode: null,
  followDetections: true,
  autoLive: false,
  customThemes: [],
}
function applied(revision = 1) {
  return {
    status: "applied",
    receipt: {
      profile: {
        ...structuredClone(initial),
        revision,
        sections: {
          ...structuredClone(initial.sections),
          settings: { ...initial.sections.settings, gain: 2 },
          bible: { translationSelection: { version: 1, code: "KJV" } },
        },
      },
      primary_translation_id: 7,
      primary_translation_code: "KJV",
      secondary_translation_code: null,
    },
  }
}
beforeEach(() => {
  vi.resetModules()
  native.invoke.mockReset()
})

it("waits for an earlier section write and publishes only the acknowledged complete profile", async () => {
  let release!: () => void
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return {
        version: 1,
        revision: 1,
        sections: { settings: { ...initial.sections.settings, gain: 1.2 } },
      }
    })
    .mockResolvedValueOnce(applied(2))
  const persistence = await import("./profile-persistence")
  const settings = await persistence.openProfileSection("settings")
  await settings.set("gain", 1.2)
  const oldWrite = settings.save()
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2))
  const publish = vi.fn()
  const restore = persistence.restoreProfileAtomically(preferences, publish)
  expect(publish).not.toHaveBeenCalled()
  release()
  await oldWrite
  await restore
  expect(native.invoke.mock.calls[2]).toEqual([
    "apply_portable_preferences",
    { expectedRevision: 1, preferences },
  ])
  expect(JSON.stringify(native.invoke.mock.calls[2])).not.toContain(
    "FAKE-LOCAL"
  )
  expect(publish).toHaveBeenCalledTimes(1)
  expect(await settings.get("gain")).toBe(2)
  expect(await settings.get("deepgramApiKey")).toBe("FAKE-LOCAL")
})

it("resumes ordinary writes after a known native rejection without advancing the cache", async () => {
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockResolvedValueOnce({
      status: "rejected",
      message: "Synthetic disk full",
    })
    .mockResolvedValueOnce({
      version: 1,
      revision: 1,
      sections: { settings: { ...initial.sections.settings, gain: 3 } },
    })
  const persistence = await import("./profile-persistence")
  const settings = await persistence.openProfileSection("settings")
  const publish = vi.fn()
  await expect(
    persistence.restoreProfileAtomically(preferences, publish)
  ).rejects.toThrow("disk full")
  expect(publish).not.toHaveBeenCalled()
  await settings.set("gain", 3)
  await settings.save()
  expect(native.invoke.mock.calls[2][1].expectedRevision).toBe(0)
})

it.each(["malformed", "transport", "publication"])(
  "blocks further writes after an uncertain %s outcome",
  async (mode) => {
    native.invoke.mockResolvedValueOnce(structuredClone(initial))
    if (mode === "transport")
      native.invoke.mockRejectedValueOnce(new Error("IPC closed"))
    else
      native.invoke.mockResolvedValueOnce(
        mode === "malformed" ? { status: "applied", receipt: {} } : applied()
      )
    const persistence = await import("./profile-persistence")
    const settings = await persistence.openProfileSection("settings")
    await expect(
      persistence.restoreProfileAtomically(preferences, () => {
        if (mode === "publication") throw new Error("state publication failed")
      })
    ).rejects.toThrow("Reload")
    await expect(settings.set("gain", 3)).rejects.toThrow("reload")
    expect(native.invoke).toHaveBeenCalledTimes(2)
  }
)

it("drops pre-restore staged edits so they cannot leak into a subsequent save", async () => {
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockResolvedValueOnce(applied())
    .mockResolvedValueOnce({
      version: 1,
      revision: 2,
      sections: {
        bible: {
          translationSelection: { version: 1, code: "KJV" },
          extra: true,
        },
      },
    })
  const persistence = await import("./profile-persistence")
  const bible = await persistence.openProfileSection("bible")
  await bible.set("translationSelection", { version: 1, code: "MISSING" })
  await persistence.restoreProfileAtomically(preferences, () => {})
  await bible.set("extra", true)
  await bible.save()
  expect(native.invoke.mock.calls[2][1]).toEqual({
    expectedRevision: 1,
    updates: {
      bible: { translationSelection: { version: 1, code: "KJV" }, extra: true },
    },
  })
})

it("marks only the synchronous store publication so persistence subscribers can suppress replay", async () => {
  native.invoke.mockResolvedValueOnce(structuredClone(initial)).mockResolvedValueOnce(applied())
  const persistence = await import("./profile-persistence")
  expect(persistence.isPublishingRestoredProfile()).toBe(false)
  await persistence.restoreProfileAtomically(preferences,()=>{
    expect(persistence.isPublishingRestoredProfile()).toBe(true)
  })
  expect(persistence.isPublishingRestoredProfile()).toBe(false)
})
