// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/fonts", () => ({
  listAllFonts: async () => ({ bundled: ["Inter"], system: [] }),
}))
vi.mock("@/components/ui/slider", () => ({
  Slider: ({
    value,
    onValueChange,
    ...props
  }: {
    value: number[]
    onValueChange: (values: number[]) => void
  }) => (
    <input
      {...props}
      type="range"
      value={value[0]}
      onChange={(e) => onValueChange([Number(e.target.value)])}
    />
  ),
}))
import { TextProperties } from "./text-properties"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const theme = {
    ...BUILTIN_THEMES[0],
    id: "bilingual-ui",
    builtin: false,
    verseText: { ...BUILTIN_THEMES[0].verseText, surface: undefined },
  }
  useBroadcastStore.setState({
    themes: [theme],
    selectedElement: "secondary",
    draftTheme: theme,
    editingThemeId: theme.id,
    isLive: false,
    liveVerse: null,
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<TextProperties />)
    await Promise.resolve()
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function input(selector: string, value: string) {
  const target = container.querySelector<HTMLInputElement>(selector)
  expect(target).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(target, value)
    target!.dispatchEvent(new Event("input", { bubbles: true }))
    target!.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
it("edits the visible secondary font size without changing primary or going live", async () => {
  const before = useBroadcastStore.getState().draftTheme!.verseText.fontSize
  await input('input[aria-label="Secondary font size"]', "80")
  expect(
    useBroadcastStore.getState().draftTheme!.secondaryVerseText?.fontSize
  ).toBe(80)
  expect(useBroadcastStore.getState().draftTheme!.verseText.fontSize).toBe(
    before
  )
  expect(useBroadcastStore.getState()).toMatchObject({
    isLive: false,
    liveVerse: null,
  })
})
it("writes the secondary plate through its own visible control", async () => {
  const checkbox = container.querySelector<HTMLInputElement>(
    'input[aria-label="Secondary Verse Plate enabled"]'
  )
  expect(checkbox).not.toBeNull()
  await act(async () => checkbox!.click())
  expect(
    useBroadcastStore.getState().draftTheme!.secondaryVerseText?.surface
      ?.enabled
  ).toBe(true)
  expect(
    useBroadcastStore.getState().draftTheme!.verseText.surface
  ).toBeUndefined()
})
it("can reset the secondary overrides to current primary styling", async () => {
  await input('input[aria-label="Secondary font size"]', "80")
  const reset = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Reset secondary style"]'
  )
  expect(reset).not.toBeNull()
  await act(async () => reset!.click())
  expect(
    useBroadcastStore.getState().draftTheme!.secondaryVerseText
  ).toBeUndefined()
  expect(
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Secondary font size"]'
    )!.value
  ).toBe(String(useBroadcastStore.getState().draftTheme!.verseText.fontSize))
})
