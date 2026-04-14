import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockSave = vi.fn()
const mockLoad = vi.fn()
const mockInvoke = vi.fn()

vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...args: unknown[]) => mockLoad(...args),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

describe("bible store persistence", () => {
  beforeEach(async () => {
    mockGet.mockReset()
    mockSet.mockReset()
    mockSave.mockReset()
    mockLoad.mockReset()
    mockInvoke.mockReset()
    mockLoad.mockResolvedValue({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    })
    mockInvoke.mockResolvedValue(undefined)
    vi.resetModules()
  })

  describe("hydrateBibleStore", () => {
    it("loads from bible.json and sets stored translation in Zustand", async () => {
      mockGet.mockResolvedValue(5)
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(mockLoad).toHaveBeenCalledWith("bible.json", { autoSave: false })
      expect(mockGet).toHaveBeenCalledWith("activeTranslationId")
      expect(useBibleStore.getState().activeTranslationId).toBe(5)
    })

    it("invokes set_active_translation with the hydrated value", async () => {
      mockGet.mockResolvedValue(5)
      const { hydrateBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 5,
      })
    })

    it("leaves default (1) when stored value is null and still pushes to Rust", async () => {
      mockGet.mockResolvedValue(null)
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().activeTranslationId).toBe(1)
      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 1,
      })
    })

    it("leaves default (1) when stored value is undefined and still pushes to Rust", async () => {
      mockGet.mockResolvedValue(undefined)
      const { hydrateBibleStore, useBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(useBibleStore.getState().activeTranslationId).toBe(1)
      expect(mockInvoke).toHaveBeenCalledWith("set_active_translation", {
        translationId: 1,
      })
    })

    it("handles load rejection gracefully without throwing", async () => {
      mockLoad.mockRejectedValue(new Error("store not available"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { hydrateBibleStore } = await import("./bible-store")

      await hydrateBibleStore()

      expect(warnSpy).toHaveBeenCalledWith(
        "[bible] Failed to hydrate bible store, using defaults"
      )
      warnSpy.mockRestore()
    })
  })

  describe("initBiblePersistence", () => {
    it("writes to bible.json when activeTranslationId changes", async () => {
      vi.useFakeTimers()
      const { initBiblePersistence, useBibleStore } = await import(
        "./bible-store"
      )

      await initBiblePersistence()
      useBibleStore.getState().setActiveTranslation(3)

      await vi.advanceTimersByTimeAsync(500)

      expect(mockSet).toHaveBeenCalledWith("activeTranslationId", 3)
      expect(mockSave).toHaveBeenCalled()
      vi.useRealTimers()
    })

    it("debounces rapid changes and only persists the last value", async () => {
      vi.useFakeTimers()
      const { initBiblePersistence, useBibleStore } = await import(
        "./bible-store"
      )

      await initBiblePersistence()
      useBibleStore.getState().setActiveTranslation(2)
      await vi.advanceTimersByTimeAsync(200)
      useBibleStore.getState().setActiveTranslation(3)
      await vi.advanceTimersByTimeAsync(200)
      useBibleStore.getState().setActiveTranslation(4)
      await vi.advanceTimersByTimeAsync(500)

      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(mockSet).toHaveBeenCalledWith("activeTranslationId", 4)
      vi.useRealTimers()
    })

    it("handles store load failure gracefully without throwing", async () => {
      mockLoad.mockRejectedValue(new Error("disk error"))
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const { initBiblePersistence } = await import("./bible-store")

      await initBiblePersistence()

      expect(warnSpy).toHaveBeenCalledWith(
        "[bible] Failed to init persistence subscription"
      )
      warnSpy.mockRestore()
    })
  })
})
