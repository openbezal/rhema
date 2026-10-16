// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/components/ui/canvas-verse", () => ({
  CanvasVerse: ({ verse }: { verse: unknown }) => (
    <pre data-testid="preview-data">{JSON.stringify(verse)}</pre>
  ),
}))
import { PreviewPanel } from "./preview-panel"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
const primary = {
  id: 1,
  translation_id: 2,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Primary preview",
}
const optional = { ...primary, translation_id: 1, text: "Optional preview" }
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
const pending = new Map<number, (row: typeof optional | null) => void>()
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
function data() {
  return JSON.parse(container.querySelector("pre")!.textContent!)
}
beforeEach(async () => {
  useSettingsStore.setState({ bookDisplayOverrides: [] })
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  pending.clear()
  mocks.invoke.mockReset().mockImplementation(
    (_command, args) =>
      new Promise((resolve) => {
        pending.set(args.verse, resolve)
      })
  )
  useBibleStore.setState({
    translations: [1, 2].map((id) => ({
      id,
      abbreviation: id === 1 ? "KJV" : "ESV",
      title: "Fixture",
      language: "en",
      is_downloaded: true,
      is_copyrighted: false,
    })),
    activeTranslationId: 2,
    activeTranslationCode: "ESV",
    secondaryTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    selectedVerse: primary,
  })
  useBroadcastStore.setState({
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<PreviewPanel />)
    await settle()
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
it("keeps primary visible while secondary loads without changing live content", async () => {
  expect(data().segments[0].text).toBe(primary.text)
  expect(mocks.invoke).toHaveBeenCalledWith(
    "get_verse",
    expect.objectContaining({ translationId: 1, verse: 16 })
  )
  await act(async () => {
    pending.get(16)?.(optional)
    await settle()
  })
  expect(data().secondary.segments[0].text).toBe(optional.text)
  expect(useBroadcastStore.getState()).toMatchObject({
    isLive: false,
    liveVerse: null,
  })
})
it("drops old secondary immediately when the browsed reference changes", async () => {
  const next = { ...primary, id: 2, verse: 17, text: "New primary preview" }
  await act(async () => {
    useBibleStore.getState().selectVerse(next)
    await settle()
  })
  await act(async () => {
    pending.get(16)?.(optional)
    await settle()
  })
  expect(data().segments[0].text).toBe(next.text)
  expect(data().secondary).toBeUndefined()
  await act(async () => {
    pending.get(17)?.({ ...optional, verse: 17, text: "New optional preview" })
    await settle()
  })
  expect(data().secondary.segments[0].text).toBe("New optional preview")
})
it("removes optional preview immediately when None is selected", async () => {
  await act(async () => {
    pending.get(16)?.(optional)
    await settle()
  })
  expect(data().secondary).toBeDefined()
  await act(async () => {
    useBibleStore.getState().setSecondaryTranslation(null)
    await settle()
  })
  expect(data().secondary).toBeUndefined()
})
it("relabels preview without restarting its pending optional lookup or changing canonical selection", async () => {
  const calls = mocks.invoke.mock.calls.length
  await act(async () =>
    useSettingsStore
      .getState()
      .setBookDisplayOverrides([
        { translationCode: "ESV", bookNumber: 43, label: "Yohanan" },
      ])
  )
  expect(data().reference).toBe("Yohanan 3:16 (ESV)")
  expect(mocks.invoke.mock.calls).toHaveLength(calls)
  await act(async () => {
    pending.get(16)?.(optional)
    await settle()
  })
  expect(data().reference).toBe("Yohanan 3:16 (ESV · KJV)")
  expect(data().segments[0].text).toBe(primary.text)
  expect(data().secondary.segments[0].text).toBe(optional.text)
  expect(useBibleStore.getState().selectedVerse?.book_name).toBe("John")
})
it("retains the source label while primary translation refresh is pending", async () => {
  await act(async () => {
    useBibleStore.getState().setActiveTranslation(1)
    await settle()
  })
  expect(data().reference).toContain("(ESV)")
  expect(data().segments[0].text).toBe(primary.text)
  expect(data().secondary).toBeUndefined()
})
it("keeps primary when optional preview text is missing or has the wrong address", async () => {
  await act(async () => {
    pending.get(16)?.({ ...optional, chapter: 4 })
    await settle()
  })
  expect(data().segments[0].text).toBe(primary.text)
  expect(data().secondary).toBeUndefined()
})
