// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { BroadcastLanguageSelector } from "./broadcast-language-selector"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
const catalog = [1, 2, 3].map((id) => ({
  id,
  abbreviation: id === 1 ? "KJV" : id === 2 ? "ESV" : "OYCB",
  title: "Fixture",
  language: id === 3 ? "yo" : "en",
  is_downloaded: id !== 3,
  is_copyrighted: false,
}))
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  useBibleStore.setState({
    translations: catalog,
    activeTranslationId: 2,
    activeTranslationCode: "ESV",
    secondaryTranslationCode: null,
    translationSelectionStatus: "ready",
  })
  useBroadcastStore.setState({ isLive: false, liveVerse: null })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<BroadcastLanguageSelector />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function select() {
  const node = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Secondary broadcast translation"]'
  )
  expect(node).not.toBeNull()
  return node!
}
it("offers None and installed distinct secondary codes without starting live output", async () => {
  expect(Array.from(select().options).map((item) => item.value)).toEqual([
    "",
    "KJV",
  ])
  await act(async () => {
    select().value = "KJV"
    select().dispatchEvent(new Event("change", { bubbles: true }))
  })
  expect(useBibleStore.getState().secondaryTranslationCode).toBe("KJV")
  expect(useBroadcastStore.getState()).toMatchObject({
    isLive: false,
    liveVerse: null,
  })
})
it("normalizes primary=secondary to None when primary changes", async () => {
  await act(async () => useBibleStore.getState().setSecondaryTranslation("KJV"))
  await act(async () => useBibleStore.getState().setActiveTranslation(1))
  expect(select().value).toBe("")
  expect(useBibleStore.getState().activeTranslationCode).toBe("KJV")
})
it("retains the secondary code when catalog IDs change", async () => {
  await act(async () => useBibleStore.getState().setSecondaryTranslation("KJV"))
  await act(async () =>
    useBibleStore
      .getState()
      .setTranslations(catalog.map((item) => ({ ...item, id: item.id + 10 })))
  )
  expect(select().value).toBe("KJV")
  expect(useBibleStore.getState().activeTranslationId).toBe(12)
})
