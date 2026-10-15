import { beforeEach, describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
const mocks = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock("./verse-renderer", () => ({ renderVerse: mocks.render }))
import { renderPresentationFrame } from "./presentation-frame"

function context() {
  const fills: unknown[][] = []
  const ctx = {
    canvas: { width: 1280, height: 720 },
    globalAlpha: 0.2,
    globalCompositeOperation: "destination-out",
    fillStyle: "red",
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: (x: number, y: number, width: number, height: number) =>
      fills.push([
        x,
        y,
        width,
        height,
        ctx.fillStyle,
        ctx.globalAlpha,
        ctx.globalCompositeOperation,
      ]),
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}
beforeEach(() => {
  mocks.render.mockReset().mockReturnValue({})
})
describe("explicit output clear frames", () => {
  it("clears the entire bitmap to transparent without painting any theme surface", () => {
    const { ctx, fills } = context()
    renderPresentationFrame(ctx, BUILTIN_THEMES[0], null, "transparent")
    expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0)
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720)
    expect(fills).toEqual([])
    expect(mocks.render).not.toHaveBeenCalled()
  })
  it("paints an opaque black bitmap independently of inherited alpha/compositing", () => {
    const { ctx, fills } = context()
    renderPresentationFrame(ctx, BUILTIN_THEMES[0], null, "black")
    expect(fills).toEqual([[0, 0, 1280, 720, "#000000", 1, "source-over"]])
    expect(mocks.render).not.toHaveBeenCalled()
  })
  it("renders only the theme background, with text plates disabled", () => {
    const { ctx } = context()
    const theme = {
      ...BUILTIN_THEMES[0],
      textBox: { ...BUILTIN_THEMES[0].textBox, enabled: true },
    }
    const before = structuredClone(theme.textBox)
    renderPresentationFrame(ctx, theme, null, "background")
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720)
    expect(mocks.render).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        textBox: expect.objectContaining({ enabled: false }),
      }),
      null,
      undefined
    )
    expect(theme.textBox).toEqual(before)
  })
  it("renders new verse content normally after any clear mode", () => {
    const { ctx } = context()
    const verse = { reference: "John 3:16", segments: [{ text: "Fixture" }] }
    renderPresentationFrame(ctx, BUILTIN_THEMES[0], verse, "transparent", {
      scale: 0.5,
    })
    expect(mocks.render).toHaveBeenCalledWith(ctx, BUILTIN_THEMES[0], verse, {
      scale: 0.5,
    })
  })
  it("falls back to opaque black if normal rendering fails", () => {
    mocks.render.mockReturnValue(null)
    const { ctx, fills } = context()
    renderPresentationFrame(ctx, BUILTIN_THEMES[0], null, "background")
    expect(fills.at(-1)).toEqual([0, 0, 1280, 720, "#000000", 1, "source-over"])
  })
})
