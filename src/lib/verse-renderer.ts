import { clearCache } from "@chenglou/pretext"
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
  type RichInlineLine,
} from "@chenglou/pretext/rich-inline"
import type {
  BroadcastTheme,
  VerseRenderData,
  RenderOptions,
} from "@/types/broadcast"

// Pretext lazily creates one internal measurement context, preferring
// OffscreenCanvas. Force that creation with a DOM canvas instead — older
// WebKit versions don't expose document webfonts to OffscreenCanvas, and a
// DOM canvas behaves identically everywhere.
function primePretextMeasureContext(): void {
  if (typeof document === "undefined") return
  const g = globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }
  const original = g.OffscreenCanvas
  try {
    g.OffscreenCanvas = undefined
    prepareRichInline([{ text: "prime", font: "16px serif" }])
  } finally {
    g.OffscreenCanvas = original
  }
  // Widths measured before a webfont finished loading came from the fallback
  // font and are cached per font string — drop them whenever loading settles.
  // (Consumers redraw on this same event.)
  document.fonts?.addEventListener("loadingdone", () => clearCache())
}
primePretextMeasureContext()

const requestedFontSpecs = new Set<string>()
const fontListeners = new Set<() => void>()

/**
 * Subscribe to "a theme font just finished loading" so consumers can redraw.
 * Driven by the FontFaceSet.load() promise rather than the "loadingdone"
 * event: WebKit's canvas can still measure the fallback font when the event
 * fires, but is reliably up to date once the load promise resolves.
 */
export function onThemeFontsLoaded(listener: () => void): () => void {
  fontListeners.add(listener)
  return () => fontListeners.delete(listener)
}

/**
 * Canvas `ctx.font` never triggers a webfont download: a registered
 * `@font-face` stays unloaded — and canvas silently draws the fallback font —
 * until DOM text or an explicit `FontFaceSet.load()` requests it. If the font
 * later loads for an unrelated reason (e.g. a DOM element uses it), drawing
 * switches to the real font while cached measurements still hold fallback
 * widths, so text overflows its measured layout box. Request every font a
 * theme uses up front; when a face actually arrives, invalidate pretext's
 * cache (redraws ride the resulting "loadingdone" event).
 */
function ensureThemeFontsLoaded(theme: BroadcastTheme): void {
  if (typeof document === "undefined" || !document.fonts?.load) return
  const specs = [
    `${theme.verseText.fontWeight} 16px "${theme.verseText.fontFamily}"`,
    `${theme.reference.fontWeight} 16px "${theme.reference.fontFamily}"`,
  ]
  for (const spec of specs) {
    if (requestedFontSpecs.has(spec)) continue
    requestedFontSpecs.add(spec)
    void document.fonts
      .load(spec)
      .then((faces) => {
        if (faces.length > 0) {
          clearCache()
          for (const listener of fontListeners) listener()
        }
      })
      .catch(() => {
        requestedFontSpecs.delete(spec)
      })
  }
}

export interface VerseLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VerseLayoutMetrics {
  scaledTheme: BroadcastTheme
  /** Region the theme background is drawn in (anchored, sized by layout.backgroundWidth/Height). */
  backgroundRect: VerseLayoutRect
  /** Rect the text box backdrop is drawn at. Always the anchored text area; never follows free-mode boxes. */
  textBoxRect: VerseLayoutRect
  textAreaRect: VerseLayoutRect
  textRect: VerseLayoutRect
  referenceRect: VerseLayoutRect | null
  verseRect: VerseLayoutRect | null
  /** Auto-fitted verse font size (scaled px). Absent when there is no verse. */
  fittedVerseFontSize?: number
  /** Free-mode element boxes in canvas px. Only set when layout.mode === "free". */
  referenceBoxRect?: VerseLayoutRect | null
  verseBoxRect?: VerseLayoutRect | null
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let currentLine = ""

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    const metrics = ctx.measureText(testLine)

    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines
}

export interface VerseInlineHandle {
  prepared: PreparedRichInline
  /** Per-item kind, indexed by RichInlineFragment.itemIndex. */
  kinds: ("word" | "verseNum")[]
  wordFont: string
  verseNumFont: string
}

/**
 * Compile verse segments into a pretext rich-inline flow: verse numbers are
 * their own atomic items so they wrap, measure, and draw with their own font
 * size. Numbers scale proportionally with the auto-fitted verse size; when
 * superscript is off they render at the full verse size (colour still applies).
 */
export function prepareVerseInline(
  theme: BroadcastTheme,
  verse: VerseRenderData,
  effectiveFontSize: number
): VerseInlineHandle | null {
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const transform = resolveTextTransform(vt.textTransform)
  const ratio = vt.fontSize > 0 ? effectiveFontSize / vt.fontSize : 1
  const verseNumFontSize = vn.superscript
    ? Math.max(1, vn.fontSize * ratio)
    : effectiveFontSize
  const wordFont = `${vt.fontWeight} ${effectiveFontSize}px "${vt.fontFamily}", serif`
  const verseNumFont = `${vt.fontWeight} ${verseNumFontSize}px "${vt.fontFamily}", serif`
  const letterSpacing = vt.letterSpacing > 0 ? vt.letterSpacing : undefined

  const items: RichInlineItem[] = []
  const kinds: ("word" | "verseNum")[] = []
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined) {
      items.push({
        text: `${segment.verseNumber} `,
        font: verseNumFont,
        letterSpacing,
        break: "never",
      })
      kinds.push("verseNum")
    }
    const text = applyTextTransform(segment.text, transform).trim()
    if (text) {
      items.push({ text: `${text} `, font: wordFont, letterSpacing })
      kinds.push("word")
    }
  }
  if (!items.length) return null

  return { prepared: prepareRichInline(items), kinds, wordFont, verseNumFont }
}

function layoutVerseLines(
  handle: VerseInlineHandle,
  maxWidth: number
): RichInlineLine[] {
  const lines: RichInlineLine[] = []
  walkRichInlineLineRanges(handle.prepared, Math.max(1, maxWidth), (range) => {
    lines.push(materializeRichInlineLineRange(handle.prepared, range))
  })
  return lines
}

function alignX(
  textAlign: "left" | "center" | "right",
  rectX: number,
  rectWidth: number
): number {
  switch (textAlign) {
    case "left":
      return rectX
    case "center":
      return rectX + rectWidth / 2
    case "right":
      return rectX + rectWidth
  }
}

function alignY(
  verticalAlign: "top" | "middle" | "bottom",
  rectY: number,
  rectHeight: number,
  contentHeight: number
): number {
  switch (verticalAlign) {
    case "middle":
      return rectY + (rectHeight - contentHeight) / 2
    case "bottom":
      return rectY + rectHeight - contentHeight
    case "top":
    default:
      return rectY
  }
}

function resolveHorizontalAlign(
  value:
    | BroadcastTheme["verseText"]["horizontalAlign"]
    | BroadcastTheme["reference"]["horizontalAlign"]
    | undefined,
  fallback: BroadcastTheme["layout"]["textAlign"],
  allowJustify: boolean
): "left" | "center" | "right" | "justify" {
  if (!value) return fallback
  if (value === "justify" && !allowJustify) return fallback
  return value
}

function resolveVerticalAlign(
  value:
    | BroadcastTheme["verseText"]["verticalAlign"]
    | BroadcastTheme["reference"]["verticalAlign"]
    | undefined
): "top" | "middle" | "bottom" {
  return value ?? "top"
}

function resolveTextTransform(
  value:
    | BroadcastTheme["verseText"]["textTransform"]
    | BroadcastTheme["reference"]["textTransform"]
    | undefined
): "none" | "uppercase" | "lowercase" | "capitalize" {
  return value ?? "none"
}

function resolveTextDecoration(
  value:
    | BroadcastTheme["verseText"]["textDecoration"]
    | BroadcastTheme["reference"]["textDecoration"]
    | undefined
): "none" | "underline" | "line-through" {
  return value ?? "none"
}

function applyTextTransform(
  text: string,
  transform: "none" | "uppercase" | "lowercase" | "capitalize"
): string {
  switch (transform) {
    case "uppercase":
      return text.toUpperCase()
    case "lowercase":
      return text.toLowerCase()
    case "capitalize":
      return text.replace(/\b\w/g, (char) => char.toUpperCase())
    case "none":
    default:
      return text
  }
}

function drawTextDecorationLine(
  ctx: CanvasRenderingContext2D,
  decoration: "none" | "underline" | "line-through",
  color: string,
  align: "left" | "center" | "right" | "justify",
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fallbackLeftX?: number
): void {
  if (decoration === "none" || width <= 0) return
  const startX =
    align === "left"
      ? x
      : align === "center"
        ? x - width / 2
        : align === "right"
          ? x - width
          : (fallbackLeftX ?? x)
  const lineY =
    decoration === "underline" ? y + fontSize * 0.92 : y + fontSize * 0.52
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, fontSize * 0.06)
  ctx.beginPath()
  ctx.moveTo(startX, lineY)
  ctx.lineTo(startX + width, lineY)
  ctx.stroke()
  ctx.restore()
}

function anchorPosition(
  anchor: BroadcastTheme["layout"]["anchor"],
  areaWidth: number,
  areaHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  let x: number
  let y: number

  switch (anchor) {
    case "top-left":
      x = 0
      y = 0
      break
    case "top-center":
      x = (canvasWidth - areaWidth) / 2
      y = 0
      break
    case "top-right":
      x = canvasWidth - areaWidth
      y = 0
      break
    case "center":
      x = (canvasWidth - areaWidth) / 2
      y = (canvasHeight - areaHeight) / 2
      break
    case "bottom-left":
      x = 0
      y = canvasHeight - areaHeight
      break
    case "bottom-center":
      x = (canvasWidth - areaWidth) / 2
      y = canvasHeight - areaHeight
      break
    case "bottom-right":
      x = canvasWidth - areaWidth
      y = canvasHeight - areaHeight
      break
  }

  return { x: x + offsetX, y: y + offsetY }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arcTo(x + width, y, x + width, y + radius, radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
  ctx.lineTo(x + radius, y + height)
  ctx.arcTo(x, y + height, x, y + height - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  rect: VerseLayoutRect,
  imageCache?: Map<string, HTMLImageElement>
): void {
  const { width, height } = theme.resolution
  const bg = theme.background

  switch (bg.type) {
    case "solid":
      ctx.fillStyle = bg.color
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      break

    case "gradient": {
      if (!bg.gradient) break
      let grad: CanvasGradient

      if (bg.gradient.type === "linear") {
        const angle = (bg.gradient.angle * Math.PI) / 180
        const cx = rect.x + rect.width / 2
        const cy = rect.y + rect.height / 2
        const len =
          Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2
        grad = ctx.createLinearGradient(
          cx - Math.cos(angle) * len,
          cy - Math.sin(angle) * len,
          cx + Math.cos(angle) * len,
          cy + Math.sin(angle) * len
        )
      } else {
        grad = ctx.createRadialGradient(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          0,
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
          Math.max(rect.width, rect.height) / 2
        )
      }

      for (const stop of bg.gradient.stops) {
        grad.addColorStop(stop.position / 100, stop.color)
      }

      ctx.fillStyle = grad
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      break
    }

    case "image": {
      if (!bg.image) {
        ctx.fillStyle = "#000"
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        break
      }
      const img = imageCache?.get(bg.image.url)
      if (!img) {
        // Use a deterministic fallback while image is still loading.
        ctx.fillStyle = bg.image.tint ?? "#000"
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        break
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(rect.x, rect.y, rect.width, rect.height)
      ctx.clip()

      if (bg.image.blur > 0) {
        ctx.filter = `blur(${bg.image.blur}px) brightness(${bg.image.brightness / 100})`
      } else if (bg.image.brightness !== 100) {
        ctx.filter = `brightness(${bg.image.brightness / 100})`
      }

      let drawX = rect.x
      let drawY = rect.y
      let drawW = rect.width
      let drawH = rect.height

      const imgRatio = img.naturalWidth / img.naturalHeight
      const rectRatio = rect.width / rect.height

      switch (bg.image.fit) {
        case "cover":
          if (imgRatio > rectRatio) {
            drawH = rect.height
            drawW = rect.height * imgRatio
            drawX = rect.x + (rect.width - drawW) / 2
          } else {
            drawW = rect.width
            drawH = rect.width / imgRatio
            drawY = rect.y + (rect.height - drawH) / 2
          }
          break
        case "contain":
          if (imgRatio > rectRatio) {
            drawW = rect.width
            drawH = rect.width / imgRatio
            drawY = rect.y + (rect.height - drawH) / 2
          } else {
            drawH = rect.height
            drawW = rect.height * imgRatio
            drawX = rect.x + (rect.width - drawW) / 2
          }
          break
        case "stretch":
          break
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH)
      ctx.restore()

      if (bg.image.tint) {
        ctx.fillStyle = bg.image.tint
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      }
      break
    }

    case "transparent":
      ctx.clearRect(0, 0, width, height)
      break
  }
}

function drawReference(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  text: string,
  textRectX: number,
  textRectWidth: number,
  y: number
): number {
  const ref = theme.reference
  const transformed = applyTextTransform(
    ref.uppercase ? text.toUpperCase() : text,
    resolveTextTransform(ref.textTransform)
  )
  const refAlign = resolveHorizontalAlign(
    ref.horizontalAlign,
    theme.layout.textAlign,
    false
  )
  const refDecoration = resolveTextDecoration(ref.textDecoration)

  ctx.save()
  ctx.font = `${ref.fontWeight} ${ref.fontSize}px "${ref.fontFamily}", sans-serif`
  ctx.fillStyle = ref.color
  ctx.textBaseline = "top"

  if (ref.letterSpacing > 0) {
    try {
      ctx.letterSpacing = `${ref.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  const canvasAlign = refAlign === "justify" ? "left" : refAlign
  ctx.textAlign = canvasAlign
  const x = alignX(canvasAlign, textRectX, textRectWidth)
  ctx.fillText(transformed, x, y)
  const drawnWidth = Math.min(
    textRectWidth,
    Math.max(1, ctx.measureText(transformed).width)
  )
  drawTextDecorationLine(
    ctx,
    refDecoration,
    ref.color,
    refAlign,
    x,
    y,
    drawnWidth,
    ref.fontSize,
    textRectX
  )
  ctx.restore()

  return ref.fontSize * 1.5
}

function drawVerseText(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectX: number,
  textRectWidth: number,
  startY: number,
  scaledFontSize?: number
): number {
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const verseDecoration = resolveTextDecoration(vt.textDecoration)
  const actualFontSize = scaledFontSize ?? vt.fontSize
  const lineHeightPx = actualFontSize * vt.lineHeight

  ctx.save()
  ctx.textBaseline = "top"
  ctx.textAlign = "left"

  if (vt.letterSpacing > 0) {
    try {
      ctx.letterSpacing = `${vt.letterSpacing}px`
    } catch {
      /* unsupported in some WebViews */
    }
  }

  const handle = prepareVerseInline(theme, verse, actualFontSize)
  if (!handle) {
    ctx.restore()
    return 0
  }
  const lines = layoutVerseLines(handle, textRectWidth)

  const drawFragment = (
    text: string,
    kind: "word" | "verseNum",
    drawX: number,
    drawY: number
  ) => {
    ctx.font = kind === "verseNum" ? handle.verseNumFont : handle.wordFont
    ctx.fillStyle = kind === "verseNum" ? vn.color : vt.color

    if (vt.shadow) {
      ctx.save()
      ctx.shadowColor = vt.shadow.color
      ctx.shadowBlur = vt.shadow.blur
      ctx.shadowOffsetX = vt.shadow.x
      ctx.shadowOffsetY = vt.shadow.y
      ctx.fillText(text, drawX, drawY)
      ctx.restore()
    }

    if (vt.outline) {
      ctx.save()
      ctx.strokeStyle = vt.outline.color
      ctx.lineWidth = vt.outline.width
      ctx.strokeText(text, drawX, drawY)
      ctx.restore()
    }

    if (!vt.shadow) {
      ctx.fillText(text, drawX, drawY)
    }
  }

  let currentY = startY
  for (const [index, line] of lines.entries()) {
    const isJustifiedLine =
      verseAlign === "justify" &&
      index < lines.length - 1 &&
      line.fragments.length > 1

    let extraGap = 0
    let lineStartX = textRectX
    let lineWidth = line.width
    if (isJustifiedLine) {
      extraGap = (textRectWidth - line.width) / (line.fragments.length - 1)
      lineWidth = textRectWidth
    } else if (verseAlign === "center") {
      lineStartX = textRectX + (textRectWidth - line.width) / 2
    } else if (verseAlign === "right") {
      lineStartX = textRectX + textRectWidth - line.width
    }

    let cursorX = lineStartX
    for (const [i, fragment] of line.fragments.entries()) {
      cursorX += fragment.gapBefore + (i > 0 ? extraGap : 0)
      drawFragment(
        fragment.text,
        handle.kinds[fragment.itemIndex],
        cursorX,
        currentY
      )
      cursorX += fragment.occupiedWidth
    }
    drawTextDecorationLine(
      ctx,
      verseDecoration,
      vt.color,
      "left",
      lineStartX,
      currentY,
      Math.min(textRectWidth, Math.max(1, lineWidth)),
      actualFontSize,
      textRectX
    )
    currentY += lineHeightPx
  }

  ctx.restore()

  return currentY - startY
}

function buildScaledTheme(
  theme: BroadcastTheme,
  scale: number
): BroadcastTheme {
  const layout = {
    ...theme.layout,
    offsetX: theme.layout.offsetX * scale,
    offsetY: theme.layout.offsetY * scale,
    padding: {
      top: theme.layout.padding.top * scale,
      right: theme.layout.padding.right * scale,
      bottom: theme.layout.padding.bottom * scale,
      left: theme.layout.padding.left * scale,
    },
  }
  return {
    ...theme,
    layout,
    resolution: {
      width: theme.resolution.width * scale,
      height: theme.resolution.height * scale,
    },
    verseText: {
      ...theme.verseText,
      fontSize: theme.verseText.fontSize * scale,
      letterSpacing: theme.verseText.letterSpacing * scale,
      shadow: theme.verseText.shadow
        ? {
            ...theme.verseText.shadow,
            blur: theme.verseText.shadow.blur * scale,
            x: theme.verseText.shadow.x * scale,
            y: theme.verseText.shadow.y * scale,
          }
        : null,
      outline: theme.verseText.outline
        ? {
            ...theme.verseText.outline,
            width: theme.verseText.outline.width * scale,
          }
        : null,
    },
    verseNumbers: {
      ...theme.verseNumbers,
      fontSize: theme.verseNumbers.fontSize * scale,
    },
    reference: {
      ...theme.reference,
      fontSize: theme.reference.fontSize * scale,
      letterSpacing: theme.reference.letterSpacing * scale,
    },
    textBox: {
      ...theme.textBox,
      borderRadius: theme.textBox.borderRadius * scale,
      padding: theme.textBox.padding * scale,
    },
  }
}

/**
 * Figure out how much vertical space is left for the verse text after accounting for the reference (and its gap).
 *
 * @param theme
 * @param textRect
 * @param referenceHeight
 * @returns
 */
function calculateMaxAvailableVerseHeight(
  theme: BroadcastTheme,
  textRect: VerseLayoutRect,
  referenceHeight: number
): number {
  const referenceGap = Math.max(
    0,
    // 0.5 x fontSize scales naturally with different themes
    theme.layout.referenceGap ?? theme.reference.fontSize * 0.5
  )

  switch (theme.reference.position) {
    case "above":
      return textRect.height - referenceHeight
    case "below":
      return textRect.height - referenceHeight - referenceGap
    case "inline":
    default:
      return textRect.height
  }
}

/** 
 * Returns the largest verse font size that fits within the available height without overflowing, using binary search.
 * 
 * @param ctx 
 * @param theme 
 * @param verse 
 * @param textRectWidth 
 * @param maxHeight 
 * @returns 
 */
function calculateScaledFontSize(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number,
  maxHeight: number
): number {
  const originalFontSize = theme.verseText.fontSize
  const minFontSize = Math.max(8, originalFontSize * 0.3) // Don't go below 30% of original or 8px

  // Binary search for optimal font size
  let low = minFontSize
  let high = originalFontSize
  let bestFit = originalFontSize

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)

    // If I use this font size, how tall will the verse be?
    const metrics = measureVerseHeight(ctx, theme, verse, textRectWidth, mid)

    // Check if the rendered verse is still too big to fit
    if (metrics.height <= maxHeight) {
      // Increase the font size
      bestFit = mid
      low = mid + 1
    } else {
      // Doesn't fit, decrease the font size
      high = mid - 1
    }
  }

  return bestFit
}

// The ctx parameter is kept for call-site symmetry with the draw path, but
// measurement now happens inside pretext's own canvas context.
export function measureVerseHeight(
  _ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number,
  fontSizeOverride?: number
): { height: number; maxLineWidth: number } {
  const vt = theme.verseText
  const verseAlign = resolveHorizontalAlign(
    vt.horizontalAlign,
    theme.layout.textAlign,
    true
  )
  const effectiveFontSize = fontSizeOverride ?? vt.fontSize
  const lineHeightPx = effectiveFontSize * vt.lineHeight
  const handle = prepareVerseInline(theme, verse, effectiveFontSize)
  if (!handle) {
    return { height: lineHeightPx, maxLineWidth: 1 }
  }
  const stats = measureRichInlineStats(handle.prepared, Math.max(1, textRectWidth))
  const maxLineWidth =
    verseAlign === "justify" && stats.lineCount > 1
      ? textRectWidth
      : stats.maxLineWidth
  return {
    height: Math.max(1, stats.lineCount) * lineHeightPx,
    maxLineWidth: Math.max(1, maxLineWidth),
  }
}

function pctBoxToPx(
  box: { x: number; y: number; width: number; height: number },
  canvasW: number,
  canvasH: number
): VerseLayoutRect {
  return {
    x: (box.x / 100) * canvasW,
    y: (box.y / 100) * canvasH,
    width: Math.max(1, (box.width / 100) * canvasW),
    height: Math.max(1, (box.height / 100) * canvasH),
  }
}

function rectForAlignedText(
  align: BroadcastTheme["layout"]["textAlign"],
  drawX: number,
  drawY: number,
  width: number,
  height: number,
  textRect: VerseLayoutRect
): VerseLayoutRect {
  let x = drawX
  if (align === "center") x = drawX - width / 2
  if (align === "right") x = drawX - width
  const clampedX = Math.max(
    textRect.x,
    Math.min(x, textRect.x + textRect.width - width)
  )
  const clampedY = Math.max(textRect.y, drawY)
  return {
    x: clampedX,
    y: clampedY,
    width: Math.min(width, textRect.width),
    height: Math.min(height, textRect.height),
  }
}

export function computeVerseLayoutMetrics(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  ensureThemeFontsLoaded(theme)
  const scale = options?.scale ?? 1
  const scaledTheme = buildScaledTheme(theme, scale)
  const canvasW = scaledTheme.resolution.width
  const canvasH = scaledTheme.resolution.height
  const layout = scaledTheme.layout

  const bgW = (layout.backgroundWidth / 100) * canvasW
  const bgH = (layout.backgroundHeight / 100) * canvasH
  const textAreaW = (layout.textAreaWidth / 100) * bgW
  const textAreaH = (layout.textAreaHeight / 100) * bgH
  const globalOffsetX = (options?.offsetX ?? 0) + layout.offsetX
  const globalOffsetY = (options?.offsetY ?? 0) + layout.offsetY
  const bgPos = anchorPosition(
    layout.anchor,
    bgW,
    bgH,
    canvasW,
    canvasH,
    globalOffsetX,
    globalOffsetY
  )
  const backgroundRect: VerseLayoutRect = {
    x: bgPos.x,
    y: bgPos.y,
    width: bgW,
    height: bgH,
  }
  // Text area is anchored within the background region (offsets are already
  // applied to the region itself). At 100% × 100% this matches anchoring to
  // the canvas directly.
  const innerPos = anchorPosition(layout.anchor, textAreaW, textAreaH, bgW, bgH, 0, 0)
  const pos = { x: bgPos.x + innerPos.x, y: bgPos.y + innerPos.y }

  const pad = layout.padding
  const textRectX = pos.x + pad.left
  const textRectY = pos.y + pad.top
  const textRectW = textAreaW - pad.left - pad.right
  const textRectH = textAreaH - pad.top - pad.bottom
  const textAreaRect: VerseLayoutRect = {
    x: pos.x,
    y: pos.y,
    width: textAreaW,
    height: textAreaH,
  }
  const textRect: VerseLayoutRect = {
    x: textRectX,
    y: textRectY,
    width: textRectW,
    height: textRectH,
  }

  const freeMode =
    layout.mode === "free" &&
    layout.referenceBox !== undefined &&
    layout.verseBox !== undefined
  const referenceBoxRect: VerseLayoutRect | null = freeMode
    ? pctBoxToPx(layout.referenceBox!, canvasW, canvasH)
    : null
  const verseBoxRect: VerseLayoutRect | null = freeMode
    ? pctBoxToPx(layout.verseBox!, canvasW, canvasH)
    : null

  if (!verse) {
    return {
      scaledTheme,
      backgroundRect,
      textBoxRect: textAreaRect,
      textAreaRect: verseBoxRect ?? textAreaRect,
      textRect: verseBoxRect ?? textRect,
      referenceRect: null,
      verseRect: null,
      referenceBoxRect,
      verseBoxRect,
    }
  }

  const referenceHeight = scaledTheme.reference.fontSize * 1.5
  const verseAlign = resolveHorizontalAlign(
    scaledTheme.verseText.horizontalAlign,
    scaledTheme.layout.textAlign,
    true
  )
  const referenceAlign = resolveHorizontalAlign(
    scaledTheme.reference.horizontalAlign,
    scaledTheme.layout.textAlign,
    false
  )

  const refText = applyTextTransform(
    scaledTheme.reference.uppercase
      ? verse.reference.toUpperCase()
      : verse.reference,
    resolveTextTransform(scaledTheme.reference.textTransform)
  )
  const measureReferenceWidth = (maxWidth: number) => {
    ctx.save()
    ctx.font = `${scaledTheme.reference.fontWeight} ${scaledTheme.reference.fontSize}px "${scaledTheme.reference.fontFamily}", sans-serif`
    const width = Math.max(
      1,
      Math.min(maxWidth, ctx.measureText(refText).width)
    )
    ctx.restore()
    return width
  }

  if (freeMode && referenceBoxRect && verseBoxRect) {
    const fittedVerseFontSize = calculateScaledFontSize(
      ctx,
      scaledTheme,
      verse,
      verseBoxRect.width,
      verseBoxRect.height
    )
    const verseMetrics = measureVerseHeight(
      ctx,
      scaledTheme,
      verse,
      verseBoxRect.width,
      fittedVerseFontSize
    )
    const verseY = alignY(
      resolveVerticalAlign(scaledTheme.verseText.verticalAlign),
      verseBoxRect.y,
      verseBoxRect.height,
      verseMetrics.height
    )
    const verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      alignX(
        verseAlign === "justify" ? "left" : verseAlign,
        verseBoxRect.x,
        verseBoxRect.width
      ),
      verseY,
      verseMetrics.maxLineWidth,
      verseMetrics.height,
      verseBoxRect
    )

    const referenceWidth = measureReferenceWidth(referenceBoxRect.width)
    const refY = alignY(
      resolveVerticalAlign(scaledTheme.reference.verticalAlign),
      referenceBoxRect.y,
      referenceBoxRect.height,
      referenceHeight
    )
    const referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      alignX(
        referenceAlign === "justify" ? "left" : referenceAlign,
        referenceBoxRect.x,
        referenceBoxRect.width
      ),
      refY,
      referenceWidth,
      referenceHeight,
      referenceBoxRect
    )

    return {
      scaledTheme,
      backgroundRect,
      textBoxRect: textAreaRect,
      textAreaRect: verseBoxRect,
      textRect: verseBoxRect,
      referenceRect,
      verseRect,
      fittedVerseFontSize,
      referenceBoxRect,
      verseBoxRect,
    }
  }

  const blockVerticalAlign = resolveVerticalAlign(
    scaledTheme.reference.position === "above"
      ? (scaledTheme.reference.verticalAlign ??
          scaledTheme.verseText.verticalAlign)
      : (scaledTheme.verseText.verticalAlign ??
          scaledTheme.reference.verticalAlign)
  )
  const referenceGap = Math.max(
    0,
    scaledTheme.layout.referenceGap ?? scaledTheme.reference.fontSize * 0.5
  )
  const fittedVerseFontSize = calculateScaledFontSize(
    ctx,
    scaledTheme,
    verse,
    textRectW,
    calculateMaxAvailableVerseHeight(scaledTheme, textRect, referenceHeight)
  )
  const verseMetrics = measureVerseHeight(
    ctx,
    scaledTheme,
    verse,
    textRectW,
    fittedVerseFontSize
  )
  const verseHeight = verseMetrics.height
  const verseDrawX = alignX(
    verseAlign === "justify" ? "left" : verseAlign,
    textRectX,
    textRectW
  )
  const referenceDrawX = alignX(
    referenceAlign === "justify" ? "left" : referenceAlign,
    textRectX,
    textRectW
  )
  const referenceWidth = measureReferenceWidth(textRectW)

  const blockHeight =
    scaledTheme.reference.position === "above"
      ? referenceHeight + verseHeight
      : scaledTheme.reference.position === "below"
        ? verseHeight + referenceGap + referenceHeight
        : verseHeight + referenceHeight
  const blockStartY = alignY(
    blockVerticalAlign,
    textRectY,
    textRectH,
    blockHeight
  )

  let referenceRect: VerseLayoutRect
  let verseRect: VerseLayoutRect
  if (scaledTheme.reference.position === "above") {
    const refY = blockStartY
    const verseY = blockStartY + referenceHeight
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
  } else if (scaledTheme.reference.position === "below") {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight + referenceGap
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  } else {
    const verseY = blockStartY
    const refY = blockStartY + verseHeight
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect
    )
  }

  return {
    scaledTheme,
    backgroundRect,
    textBoxRect: textAreaRect,
    textAreaRect,
    textRect,
    referenceRect,
    verseRect,
    fittedVerseFontSize,
    referenceBoxRect: null,
    verseBoxRect: null,
  }
}

export function renderVerse(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics | null {
  try {
    return renderVerseImpl(ctx, theme, verse, options)
  } catch (e) {
    console.error("[verse-renderer] render error:", e)
    return null
  }
}

function renderVerseImpl(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions
): VerseLayoutMetrics {
  const metrics = computeVerseLayoutMetrics(ctx, theme, verse, options)
  const scaledTheme = metrics.scaledTheme

  ctx.save()

  // Apply global opacity
  if (options?.opacity !== undefined) {
    ctx.globalAlpha = options.opacity
  }

  // Draw background
  drawBackground(ctx, scaledTheme, metrics.backgroundRect, options?.imageCache)

  // Draw text box if enabled
  if (scaledTheme.textBox.enabled) {
    ctx.save()
    ctx.globalAlpha = (options?.opacity ?? 1) * scaledTheme.textBox.opacity
    ctx.fillStyle = scaledTheme.textBox.color
    roundRect(
      ctx,
      metrics.textBoxRect.x,
      metrics.textBoxRect.y,
      metrics.textBoxRect.width,
      metrics.textBoxRect.height,
      scaledTheme.textBox.borderRadius
    )
    ctx.fill()
    ctx.restore()
  }

  // If no verse data, just draw the background and text box
  if (!verse) {
    ctx.restore()
    return metrics
  }

  const referenceRect = metrics.referenceRect
  const verseRect = metrics.verseRect
  const verseArea = metrics.verseBoxRect ?? metrics.textRect
  const referenceArea = metrics.referenceBoxRect ?? metrics.textRect
  if (verseRect) {
    drawVerseText(
      ctx,
      scaledTheme,
      verse,
      verseArea.x,
      verseArea.width,
      verseRect.y,
      metrics.fittedVerseFontSize
    )
  }
  if (referenceRect) {
    drawReference(
      ctx,
      scaledTheme,
      verse.reference,
      referenceArea.x,
      referenceArea.width,
      referenceRect.y
    )
  }

  ctx.restore()
  return metrics
}
