import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import {
  presentPrimaryVerse,
  invalidatePresentation,
} from "./presentation-controller"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Verse } from "@/types"
const row: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified primary fixture",
}
beforeEach(() => {
  invalidatePresentation()
  mocks.invoke.mockReset()
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    secondaryTranslationCode: "BSRK",
    translationSelectionStatus: "ready",
    translations: [1, 2].map((id) => ({
      id,
      abbreviation: id === 1 ? "KJV" : "BSRK",
      title: "Fixture",
      language: "en",
      is_downloaded: true,
      is_copyrighted: false,
    })),
  })
  useBroadcastStore.setState({
    presentationRecovery: "ready",
    isLive: true,
    liveVerse: null,
    liveSourceVerse: null,
  })
})
it("completes at verified primary commit while optional enrichment continues", async () => {
  let release!: (value: Verse) => void
  const optional = new Promise<Verse>((resolve) => {
    release = resolve
  })
  mocks.invoke.mockImplementation(
    (_command: string, args: { translationId: number }) =>
      args.translationId === 1 ? Promise.resolve(row) : optional
  )
  await expect(presentPrimaryVerse(row)).resolves.toBe(true)
  expect(useBroadcastStore.getState().liveSourceVerse).toEqual(row)
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
  release({ ...row, translation_id: 2, text: "Verified optional fixture" })
  await vi.waitFor(() =>
    expect(
      useBroadcastStore.getState().liveVerse?.secondary?.translationCode
    ).toBe("BSRK")
  )
})
it.each(["missing", "error"])(
  "releases the action without a primary commit after %s lookup",
  async (failure) => {
    let release!: (value: null) => void
    const optional = new Promise<null>((resolve) => {
      release = resolve
    })
    mocks.invoke.mockImplementation(
      (_command: string, args: { translationId: number }) =>
        args.translationId !== 1
          ? optional
          : failure === "error"
            ? Promise.reject(new Error("Lookup failed"))
            : Promise.resolve(null)
    )
    try {
      await expect(presentPrimaryVerse(row)).resolves.toBe(false)
      expect(useBroadcastStore.getState().liveSourceVerse).toBeNull()
    } finally {
      release(null)
    }
  }
)
