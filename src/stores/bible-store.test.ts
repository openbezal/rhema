import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Translation } from "@/types"

const { mockGet, mockSet, mockSave, mockDelete, mockLoad, mockInvoke } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockSet: vi.fn(), mockSave: vi.fn(), mockDelete: vi.fn(), mockLoad: vi.fn(), mockInvoke: vi.fn(),
}))
vi.mock("@tauri-apps/plugin-store", () => ({ load: mockLoad }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

function translation(id: number, abbreviation: string): Translation {
  return { id, abbreviation, title: abbreviation, language: "en", is_copyrighted: false, is_downloaded: true }
}
const catalog = [translation(7, "KJV"), translation(2, "OYCB"), translation(9, "ESV"), translation(4, "NIV")]
const saved = (code: string) => ({ version: 1, code, catalog: { KJV: 1, ESV: 2, NIV: 3 } })
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.resetModules()
  mockGet.mockReset().mockResolvedValue(null)
  mockSet.mockReset().mockResolvedValue(undefined)
  mockSave.mockReset().mockResolvedValue(undefined)
  mockDelete.mockReset().mockResolvedValue(true)
  mockLoad.mockReset().mockResolvedValue({ get: mockGet, set: mockSet, save: mockSave, delete: mockDelete })
  mockInvoke.mockReset().mockImplementation((command) => command === "list_translations" ? Promise.resolve(catalog) : Promise.resolve(undefined))
})
afterEach(() => { cleanups.splice(0).forEach((stop) => stop()); vi.useRealTimers(); vi.restoreAllMocks() })

describe("stable Bible translation persistence", () => {
  it.each(["KJV", "ESV", "NIV"])("restores %s by code when database IDs change", async (code) => {
    mockGet.mockImplementation((key) => Promise.resolve(key === "translationSelection" ? saved(code) : 2))
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await hydrateBibleStore()
    const expected = catalog.find((item) => item.abbreviation === code)!
    expect(useBibleStore.getState().activeTranslationId).toBe(expected.id)
    expect(useBibleStore.getState().activeTranslationCode).toBe(code)
    expect(useBibleStore.getState().translationSelectionStatus).toBe("ready")
    expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", { translationId: expected.id })
  })

  it("requires reselection for an unverified legacy numeric ID", async () => {
    mockGet.mockImplementation((key) => Promise.resolve(key === "activeTranslationId" ? 2 : null))
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await hydrateBibleStore()
    expect(useBibleStore.getState().translationSelectionStatus).toBe("needs_confirmation")
    expect(mockInvoke).not.toHaveBeenCalledWith("set_active_translation", expect.anything())
    expect(useBibleStore.getState().activeTranslationId).not.toBe(2)
  })

  it("uses the installed KJV ID on a fresh installation", async () => {
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await hydrateBibleStore()
    expect(useBibleStore.getState().activeTranslationId).toBe(7)
    expect(useBibleStore.getState().translationSelectionStatus).toBe("ready")
  })

  it.each([saved("MISSING"), { version: 2, code: "ESV" }, { version: 1, code: 2 }])("does not guess from an unavailable or unsupported selection %j", async (selection) => {
    mockGet.mockImplementation((key) => Promise.resolve(key === "translationSelection" ? selection : 2))
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await hydrateBibleStore()
    expect(useBibleStore.getState().translationSelectionStatus).toBe("needs_confirmation")
    expect(mockInvoke).not.toHaveBeenCalledWith("set_active_translation", expect.anything())
  })

  it("keeps presentation unavailable when translation metadata cannot load", async () => {
    mockInvoke.mockRejectedValue(new Error("database unavailable"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await expect(hydrateBibleStore()).resolves.toBeUndefined()
    expect(useBibleStore.getState().translationSelectionStatus).toBe("unavailable")
  })

  it("requires a deliberate selection if saved preferences cannot be read", async () => {
    mockLoad.mockRejectedValue(new Error("unreadable preferences"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { hydrateBibleStore, useBibleStore } = await import("./bible-store")
    await hydrateBibleStore()
    expect(useBibleStore.getState().translations).toEqual(catalog)
    expect(useBibleStore.getState().translationSelectionStatus).toBe("needs_confirmation")
  })

  it("confirms a known selection and ignores unknown IDs", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ translationSelectionStatus: "needs_confirmation" })
    useBibleStore.getState().setTranslations(catalog)
    useBibleStore.getState().setActiveTranslation(9)
    expect(useBibleStore.getState().activeTranslationCode).toBe("ESV")
    expect(useBibleStore.getState().translationSelectionStatus).toBe("ready")
    useBibleStore.getState().setActiveTranslation(1234)
    expect(useBibleStore.getState().activeTranslationId).toBe(9)
  })

  it("leaves setup accessible when no installed translations remain", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.getState().setTranslations(catalog)
    useBibleStore.getState().setTranslations([])
    expect(useBibleStore.getState().translationSelectionStatus).toBe("unavailable")
  })

  it("confirms only after the backend accepts the selected translation", async () => {
    const { activateTranslation, useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ translations: catalog, activeTranslationCode: null, translationSelectionStatus: "needs_confirmation" })
    mockInvoke.mockRejectedValueOnce(new Error("activation failed"))
    await expect(activateTranslation(9)).rejects.toThrow("activation failed")
    expect(useBibleStore.getState().translationSelectionStatus).toBe("needs_confirmation")
    await activateTranslation(9)
    expect(useBibleStore.getState().activeTranslationCode).toBe("ESV")
    expect(useBibleStore.getState().translationSelectionStatus).toBe("ready")
  })

  it("persists a versioned code and catalog mapping, removing the legacy key", async () => {
    vi.useFakeTimers()
    const { initBiblePersistence, useBibleStore } = await import("./bible-store")
    useBibleStore.getState().setTranslations(catalog)
    const stop = await initBiblePersistence()
    if (stop) cleanups.push(stop)
    useBibleStore.getState().setActiveTranslation(9)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSet).toHaveBeenCalledWith("translationSelection", { version: 1, code: "ESV", catalog: { KJV: 7, OYCB: 2, ESV: 9, NIV: 4 } })
    expect(mockDelete).toHaveBeenCalledWith("activeTranslationId")
    expect(mockSave).toHaveBeenCalled()
  })

  it("cancels a pending save when the translation needs confirmation again", async () => {
    vi.useFakeTimers()
    const { initBiblePersistence, useBibleStore } = await import("./bible-store")
    useBibleStore.getState().setTranslations(catalog)
    const stop = await initBiblePersistence()
    cleanups.push(stop)
    useBibleStore.getState().setActiveTranslation(9)
    useBibleStore.setState({ translationSelectionStatus: "needs_confirmation" })
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("orders slow saves so an older choice cannot overwrite a newer one", async () => {
    vi.useFakeTimers()
    let finish!: () => void
    mockSet.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const { initBiblePersistence, useBibleStore } = await import("./bible-store")
    useBibleStore.getState().setTranslations(catalog)
    cleanups.push(await initBiblePersistence())
    useBibleStore.getState().setActiveTranslation(9)
    await vi.advanceTimersByTimeAsync(500)
    useBibleStore.getState().setActiveTranslation(4)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSet).toHaveBeenCalledTimes(1)
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(mockSet).toHaveBeenCalledTimes(2)
    expect(mockSet).toHaveBeenLastCalledWith("translationSelection", expect.objectContaining({ code: "NIV" }))
  })

  it("debounces changes and cleans up pending persistence", async () => {
    vi.useFakeTimers()
    const { initBiblePersistence, useBibleStore } = await import("./bible-store")
    useBibleStore.getState().setTranslations(catalog)
    const stop = await initBiblePersistence()
    if (stop) cleanups.push(stop)
    useBibleStore.getState().setActiveTranslation(9)
    await vi.advanceTimersByTimeAsync(200)
    useBibleStore.getState().setActiveTranslation(4)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenLastCalledWith("translationSelection", expect.objectContaining({ code: "NIV" }))
    useBibleStore.getState().setActiveTranslation(7)
    stop?.()
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSet).toHaveBeenCalledTimes(1)
  })
})

describe("requestVerseReveal", () => {
  it("increments the counter and records the requested scroll block", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ revealRequest: 0, revealBlock: "nearest" })

    useBibleStore.getState().requestVerseReveal("center")

    expect(useBibleStore.getState().revealRequest).toBe(1)
    expect(useBibleStore.getState().revealBlock).toBe("center")
  })

  it("fires again for an identical consecutive request", async () => {
    const { useBibleStore } = await import("./bible-store")
    useBibleStore.setState({ revealRequest: 0, revealBlock: "nearest" })

    useBibleStore.getState().requestVerseReveal("nearest")
    useBibleStore.getState().requestVerseReveal("nearest")

    expect(useBibleStore.getState().revealRequest).toBe(2)
  })
})
