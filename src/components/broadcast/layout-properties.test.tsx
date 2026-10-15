// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@chenglou/pretext/rich-inline", () => ({
  prepareRichInline: (items: unknown) => ({ items }),
  measureRichInlineStats: () => ({ lineCount: 1, maxLineWidth: 200 }),
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
      onChange={(event) => onValueChange([Number(event.target.value)])}
    />
  ),
}))
import { LayoutProperties } from "./layout-properties"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    save() {},
    restore() {},
    measureText: () => ({ width: 200 }),
  } as unknown as CanvasRenderingContext2D)
  const theme = {
    ...BUILTIN_THEMES[0],
    id: "layout-ui",
    builtin: false,
    layout: { ...BUILTIN_THEMES[0].layout, mode: "stacked" as const },
  }
  useBroadcastStore.setState({
    draftTheme: theme,
    themes: [theme],
    isLive: false,
    liveVerse: null,
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<LayoutProperties />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function setInput(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector)
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input!.dispatchEvent(new Event("input", { bubbles: true }))
    input!.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
it("exposes the primary share and language gap used by stacked output geometry", async () => {
  await setInput('input[aria-label="Primary region share"]', "65")
  await setInput('input[aria-label="Language gap"]', "32")
  expect(useBroadcastStore.getState().draftTheme!.layout).toMatchObject({
    primaryShare: 65,
    languageGap: 32,
  })
})
it("seeds all three regions when enabling free positioning", async () => {
  const toggle = container.querySelector<HTMLInputElement>(
    'input[aria-label="Free positioning"]'
  )
  expect(toggle).not.toBeNull()
  await act(async () => toggle!.click())
  expect(useBroadcastStore.getState().draftTheme!.layout).toMatchObject({
    mode: "free",
    referenceBox: expect.any(Object),
    verseBox: expect.any(Object),
    secondaryBox: expect.any(Object),
  })
})
it("edits the secondary free box without moving the primary box", async () => {
  const layout = {
    ...useBroadcastStore.getState().draftTheme!.layout,
    mode: "free" as const,
    referenceBox: { x: 5, y: 5, width: 80, height: 10 },
    verseBox: { x: 5, y: 20, width: 40, height: 60 },
    secondaryBox: { x: 55, y: 20, width: 40, height: 60 },
  }
  await act(async () => useBroadcastStore.getState().updateDraft({ layout }))
  await setInput('input[aria-label="Secondary Block X"]', "50")
  expect(useBroadcastStore.getState().draftTheme!.layout.secondaryBox!.x).toBe(
    50
  )
  expect(useBroadcastStore.getState().draftTheme!.layout.verseBox).toEqual(
    layout.verseBox
  )
})
