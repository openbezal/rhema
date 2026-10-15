import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Verse, Book } from "@/types"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
import { useBibleStore } from "@/stores/bible-store"
import { connectBibleCatalog } from "./bible-catalog"
import { connectPreviewSelection } from "./preview-selection"
const row: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "KJV text",
}
const book: Book = {
  id: 43,
  translation_id: 1,
  book_number: 43,
  name: "John",
  abbreviation: "Jn",
  testament: "NT",
}
const translations = [
  {
    id: 1,
    abbreviation: "KJV",
    title: "King James Version",
    language: "en",
    is_downloaded: true,
    is_copyrighted: false,
  },
  {
    id: 2,
    abbreviation: "ESV",
    title: "English Standard Version",
    language: "en",
    is_downloaded: true,
    is_copyrighted: true,
  },
]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const cleanups: (() => void)[] = []
beforeEach(() => {
  mocks.invoke.mockReset()
  useBibleStore.setState({
    ...useBibleStore.getInitialState(),
    translations,
    selectedVerse: row,
    currentChapter: [row],
  })
})
afterEach(() => cleanups.splice(0).forEach((stop) => stop()))
describe("Bible state without mounted panels", () => {
  it("loads the ready catalog and defaults to its first available book without SearchPanel", async () => {
    useBibleStore.setState({ selectedVerse: null, currentChapter: [] })
    mocks.invoke.mockResolvedValue([book])
    cleanups.push(connectBibleCatalog())
    await vi.waitFor(() =>
      expect(useBibleStore.getState().books).toEqual([book])
    )
    expect(useBibleStore.getState().pendingNavigation).toEqual({
      bookNumber: 43,
      chapter: 1,
      verse: 1,
    })
  })
  it("does not read the unconfirmed catalog and rejects a stale catalog response", async () => {
    const old = deferred<Book[]>()
    mocks.invoke
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue([{ ...book, translation_id: 2 }])
    useBibleStore.setState({ translationSelectionStatus: "loading" })
    cleanups.push(connectBibleCatalog())
    expect(mocks.invoke).not.toHaveBeenCalled()
    useBibleStore.setState({ translationSelectionStatus: "ready" })
    useBibleStore.getState().setActiveTranslation(2)
    await vi.waitFor(() =>
      expect(useBibleStore.getState().books[0]?.translation_id).toBe(2)
    )
    old.resolve([book])
    await Promise.resolve()
    await Promise.resolve()
    expect(useBibleStore.getState().books[0]?.translation_id).toBe(2)
  })
  it("refreshes the browsed verse after translation changes without PreviewPanel", async () => {
    const esv = { ...row, translation_id: 2, text: "ESV text" }
    mocks.invoke.mockResolvedValue(esv)
    cleanups.push(connectPreviewSelection())
    useBibleStore.getState().setActiveTranslation(2)
    await vi.waitFor(() =>
      expect(useBibleStore.getState().selectedVerse).toEqual(esv)
    )
  })
  it("does not overwrite a newer preview selection with an older translation refresh", async () => {
    const old = deferred<Verse>()
    mocks.invoke.mockReturnValue(old.promise)
    cleanups.push(connectPreviewSelection())
    useBibleStore.getState().setActiveTranslation(2)
    const newer = {
      ...row,
      translation_id: 2,
      verse: 17,
      text: "Newer selection",
    }
    useBibleStore.getState().selectVerse(newer)
    old.resolve({ ...row, translation_id: 2, text: "Old refresh" })
    await Promise.resolve()
    await Promise.resolve()
    expect(useBibleStore.getState().selectedVerse).toEqual(newer)
  })
  it("retains the correctly attributed preview if primary refresh returns another reference", async () => {
    mocks.invoke.mockResolvedValue({ ...row, translation_id: 2, chapter: 4 })
    cleanups.push(connectPreviewSelection())
    useBibleStore.getState().setActiveTranslation(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(useBibleStore.getState().selectedVerse).toEqual(row)
  })
  it("discards preview and catalog results after app cleanup", async () => {
    const pending = deferred<Verse>()
    mocks.invoke.mockReturnValue(pending.promise)
    const stop = connectPreviewSelection()
    useBibleStore.getState().setActiveTranslation(2)
    stop()
    pending.resolve({ ...row, translation_id: 2 })
    await Promise.resolve()
    await Promise.resolve()
    expect(useBibleStore.getState().selectedVerse).toEqual(row)
  })
})
