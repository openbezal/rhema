import { renderVerse } from "./verse-renderer"
import type {
  BroadcastTheme,
  VerseRenderData,
  OutputClearMode,
  RenderOptions,
} from "@/types"

/** Clear the whole pixel buffer before drawing; explicit clears ignore theme plates and inherited alpha. */
export function renderPresentationFrame(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  mode: OutputClearMode = "background",
  options?: RenderOptions
): void {
  const clear = (black: boolean) => {
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    if (black) {
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = "#000000"
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    }
    ctx.restore()
  }
  clear(!verse && mode === "black")
  if (!verse && mode !== "background") return
  const background = verse
    ? theme
    : { ...theme, textBox: { ...theme.textBox, enabled: false } }
  if (!renderVerse(ctx, background, verse, options)) clear(true)
}
