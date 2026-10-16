import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
const initial = {
  version: 1,
  revision: 0,
  sections: {
    settings: { gain: 1, deepgramApiKey: "FAKE-LOCAL", futureKey: true },
    bible: { translationSelection: { version: 1, code: "KJV" } },
    broadcast: { customThemes: [{ name: "Ọlọ́run" }] },
  },
}
beforeEach(() => {
  native.invoke.mockReset()
  vi.resetModules()
})

it("shares checked hydration across stores and detaches returned objects", async () => {
  native.invoke.mockResolvedValue(structuredClone(initial))
  const { openProfileSection } = await import("./profile-persistence")
  const [settings, broadcast] = await Promise.all([
    openProfileSection("settings"),
    openProfileSection("broadcast"),
  ])
  expect(native.invoke).toHaveBeenCalledTimes(1)
  expect(await settings.get("deepgramApiKey")).toBe("FAKE-LOCAL")
  const themes = await broadcast.get<Array<{ name: string }>>("customThemes")
  themes![0].name = "changed locally"
  expect(await broadcast.get("customThemes")).toEqual([{ name: "Ọlọ́run" }])
})

it("orders concurrent section saves using each successful revision", async () => {
  let persisted = structuredClone(initial)
  native.invoke.mockImplementation(
    async (
      command: string,
      args: { expectedRevision: number; updates: Record<string, unknown> }
    ) => {
      if (command === "read_local_profile") return structuredClone(persisted)
      expect(args.expectedRevision).toBe(persisted.revision)
      persisted = {
        ...persisted,
        revision: persisted.revision + 1,
        sections: { ...persisted.sections, ...args.updates },
      }
      return structuredClone(persisted)
    }
  )
  const { openProfileSection } = await import("./profile-persistence")
  const [settings, bible] = await Promise.all([
    openProfileSection("settings"),
    openProfileSection("bible"),
  ])
  await settings.set("gain", 2)
  await bible.set("translationSelection", { version: 1, code: "BIUO" })
  await Promise.all([settings.save(), bible.save()])
  expect(persisted.revision).toBe(2)
  expect(persisted.sections.settings).toEqual({
    gain: 2,
    deepgramApiKey: "FAKE-LOCAL",
    futureKey: true,
  })
  expect(persisted.sections.bible).toEqual({
    translationSelection: { version: 1, code: "BIUO" },
  })
})

it("keeps failed changes retryable without advancing the successful cache", async () => {
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockResolvedValueOnce({
      ...structuredClone(initial),
      revision: 1,
      sections: {
        ...initial.sections,
        settings: { ...initial.sections.settings, gain: 2 },
      },
    })
  const { openProfileSection } = await import("./profile-persistence")
  const settings = await openProfileSection("settings")
  await settings.set("gain", 2)
  await expect(settings.save()).rejects.toThrow("Disk full")
  expect(await settings.get("gain")).toBe(2)
  await settings.save()
  expect(native.invoke.mock.calls[2]).toEqual([
    "write_local_profile",
    {
      expectedRevision: 0,
      updates: {
        settings: { gain: 2, deepgramApiKey: "FAKE-LOCAL", futureKey: true },
      },
    },
  ])
})

it("retains a newer value when an older save finishes", async () => {
  let release!: (value: unknown) => void
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    .mockResolvedValueOnce({
      ...structuredClone(initial),
      revision: 2,
      sections: {
        ...initial.sections,
        settings: { ...initial.sections.settings, gain: 3 },
      },
    })
  const { openProfileSection } = await import("./profile-persistence")
  const settings = await openProfileSection("settings")
  await settings.set("gain", 2)
  const older = settings.save()
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2))
  await settings.set("gain", 3)
  const newer = settings.save()
  release({
    ...structuredClone(initial),
    revision: 1,
    sections: {
      ...initial.sections,
      settings: { ...initial.sections.settings, gain: 2 },
    },
  })
  await Promise.all([older, newer])
  expect(await settings.get("gain")).toBe(3)
  expect(native.invoke.mock.calls[2][1]).toEqual({
    expectedRevision: 1,
    updates: {
      settings: { gain: 3, deepgramApiKey: "FAKE-LOCAL", futureKey: true },
    },
  })
})

it("deletes legacy keys while retaining unrelated values", async () => {
  const data = {
    ...structuredClone(initial),
    sections: {
      ...initial.sections,
      bible: {
        translationSelection: { version: 1, code: "KJV" },
        activeTranslationId: 3,
        extra: true,
      },
    },
  }
  native.invoke.mockResolvedValueOnce(data).mockResolvedValueOnce({
    ...data,
    revision: 1,
    sections: {
      ...data.sections,
      bible: {
        translationSelection: { version: 1, code: "KJV" },
        extra: true,
      },
    },
  })
  const { openProfileSection } = await import("./profile-persistence")
  const bible = await openProfileSection("bible")
  await bible.delete("activeTranslationId")
  await bible.save()
  expect(native.invoke.mock.calls[1][1]).toEqual({
    expectedRevision: 0,
    updates: {
      bible: { translationSelection: { version: 1, code: "KJV" }, extra: true },
    },
  })
})

it("retries a failed read and never writes defaults from unreadable data", async () => {
  native.invoke
    .mockRejectedValueOnce(new Error("Corrupt profile"))
    .mockResolvedValueOnce(structuredClone(initial))
  const { openProfileSection } = await import("./profile-persistence")
  await expect(openProfileSection("settings")).rejects.toThrow(
    "Corrupt profile"
  )
  const settings = await openProfileSection("settings")
  expect(await settings.get("gain")).toBe(1)
  expect(native.invoke.mock.calls.map((call) => call[0])).toEqual([
    "read_local_profile",
    "read_local_profile",
  ])
})

it("rejects future native profile receipts before exposing data", async () => {
  native.invoke.mockResolvedValue({ ...initial, version: 99 })
  const { openProfileSection } = await import("./profile-persistence")
  await expect(openProfileSection("settings")).rejects.toThrow()
  expect(native.invoke).toHaveBeenCalledTimes(1)
})

it("accepts a small changed-section receipt while retaining the other cached sections", async () => {
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockResolvedValueOnce({
      version: 1,
      revision: 1,
      sections: { settings: { ...initial.sections.settings, gain: 2 } },
    })
  const { openProfileSection } = await import("./profile-persistence")
  const settings = await openProfileSection("settings")
  await settings.set("gain", 2)
  await settings.save()
  const bible = await openProfileSection("bible")
  const broadcast = await openProfileSection("broadcast")
  expect(await bible.get("translationSelection")).toEqual({
    version: 1,
    code: "KJV",
  })
  expect(await broadcast.get("customThemes")).toEqual([{ name: "Ọlọ́run" }])
})

it("keeps a failed startup visible even if a later section retries successfully", async () => {
  native.invoke
    .mockRejectedValueOnce(new Error("unreadable FAKE-LOCAL"))
    .mockResolvedValueOnce(structuredClone(initial))
  const { openProfileSection } = await import("./profile-persistence")
  const { useProfileStatusStore } = await import("./profile-status")
  await expect(openProfileSection("settings")).rejects.toThrow("unreadable")
  expect(useProfileStatusStore.getState().readFailed).toBe(true)
  await openProfileSection("bible")
  expect(useProfileStatusStore.getState().readFailed).toBe(true)
  expect(native.invoke).toHaveBeenCalledTimes(2)
})

it.each([{}, { bible: { other: true } }])(
  "rejects a receipt missing the saved section: %j",
  async (sections) => {
    native.invoke
      .mockResolvedValueOnce(structuredClone(initial))
      .mockResolvedValueOnce({ version: 1, revision: 1, sections })
      .mockResolvedValueOnce({
        version: 1,
        revision: 1,
        sections: { settings: { ...initial.sections.settings, gain: 2 } },
      })
    const { openProfileSection } = await import("./profile-persistence")
    const settings = await openProfileSection("settings")
    await settings.set("gain", 2)
    await expect(settings.save()).rejects.toThrow(
      "Invalid operator profile save receipt"
    )
    await settings.save()
    expect(native.invoke.mock.calls[2][1].expectedRevision).toBe(0)
  }
)

it("discards a canceled save's captured edits rather than retrying them with a later edit", async () => {
  native.invoke
    .mockResolvedValueOnce(structuredClone(initial))
    .mockResolvedValueOnce({
      version: 1,
      revision: 1,
      sections: { bible: { ...initial.sections.bible, extra: true } },
    })
  const { openProfileSection } = await import("./profile-persistence")
  const bible = await openProfileSection("bible")
  await bible.set("translationSelection", { version: 1, code: "BIUO" })
  await bible.save(() => false)
  expect(native.invoke).toHaveBeenCalledTimes(1)
  await bible.set("extra", true)
  await bible.save()
  expect(native.invoke.mock.calls[1][1]).toEqual({
    expectedRevision: 0,
    updates: { bible: { ...initial.sections.bible, extra: true } },
  })
})
