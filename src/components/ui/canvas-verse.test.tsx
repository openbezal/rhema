// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  ready: [] as (() => void)[],
}))
vi.mock("@/lib/presentation-frame", () => ({
  renderPresentationFrame: mocks.render,
}))
vi.mock("@/lib/verse-renderer", () => ({ onThemeFontsLoaded: () => () => {} }))
vi.mock("@/lib/theme-image-cache", () => ({
  themeImageCache: () => new Map(),
  preloadThemeImages: (
    theme: { background: { image?: { url: string } | null } },
    ready: () => void
  ) => {
    if (theme.background.image?.url) mocks.ready.push(ready)
  },
}))
import { CanvasVerse } from "./canvas-verse"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
let root: Root
beforeEach(() => {
  mocks.render.mockClear()
  mocks.ready.length = 0
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      notify: () => void
      constructor(callback: ResizeObserverCallback) {
        this.notify = () =>
          callback(
            [{ contentRect: { width: 800 } }] as ResizeObserverEntry[],
            this as unknown as ResizeObserver
          )
      }
      observe() {
        this.notify()
      }
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    scale: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  root = createRoot(document.createElement("div"))
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe("canvas asset completion", () => {
  it.each(["transparent", "black", "background"] as const)(
    "retains current %s clear after an obsolete theme image completes",
    async (mode) => {
      const first = {
        ...BUILTIN_THEMES[0],
        background: {
          ...BUILTIN_THEMES[0].background,
          type: "image" as const,
          image: {
            url: "pending.png",
            fit: "cover" as const,
            opacity: 1,
            tint: null,
          blur: 0,
          brightness: 1,
          },
        },
      }
      const current = BUILTIN_THEMES[0]
      const verse = { reference: "John 3:16", segments: [{ text: "Old text" }] }
      await act(async () =>
        root.render(<CanvasVerse theme={first} verse={verse} />)
      )
      await act(async () =>
        root.render(<CanvasVerse theme={current} verse={verse} />)
      )
      await act(async () =>
        root.render(
          <CanvasVerse theme={current} verse={null} clearMode={mode} />
        )
      )
      mocks.ready.forEach((ready) => ready())
      const last = mocks.render.mock.calls.at(-1)
      expect(last?.[1]).toBe(current)
      expect(last?.[2]).toBeNull()
      expect(last?.[3]).toBe(mode)
    }
  )
})
