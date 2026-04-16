import type {
  BroadcastTheme,
  VerseRenderData,
  RenderOptions,
} from "@/types/broadcast"

export interface VerseLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface VerseLayoutMetrics {
  scaledTheme: BroadcastTheme
  textAreaRect: VerseLayoutRect
  textRect: VerseLayoutRect
  referenceRect: VerseLayoutRect | null
  verseRect: VerseLayoutRect | null
}

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
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

function alignX(
  textAlign: "left" | "center" | "right",
  rectX: number,
  rectWidth: number,
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
  contentHeight: number,
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
  value: BroadcastTheme["verseText"]["horizontalAlign"] | BroadcastTheme["reference"]["horizontalAlign"] | undefined,
  fallback: BroadcastTheme["layout"]["textAlign"],
  allowJustify: boolean,
): "left" | "center" | "right" | "justify" {
  if (!value) return fallback
  if (value === "justify" && !allowJustify) return fallback
  return value
}

function resolveVerticalAlign(
  value: BroadcastTheme["verseText"]["verticalAlign"] | BroadcastTheme["reference"]["verticalAlign"] | undefined,
): "top" | "middle" | "bottom" {
  return value ?? "top"
}

function resolveTextTransform(
  value: BroadcastTheme["verseText"]["textTransform"] | BroadcastTheme["reference"]["textTransform"] | undefined,
): "none" | "uppercase" | "lowercase" | "capitalize" {
  return value ?? "none"
}

function resolveTextDecoration(
  value: BroadcastTheme["verseText"]["textDecoration"] | BroadcastTheme["reference"]["textDecoration"] | undefined,
): "none" | "underline" | "line-through" {
  return value ?? "none"
}

function applyTextTransform(text: string, transform: "none" | "uppercase" | "lowercase" | "capitalize"): string {
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
  fallbackLeftX?: number,
): void {
  if (decoration === "none" || width <= 0) return
  const startX = align === "left"
    ? x
    : align === "center"
      ? x - width / 2
      : align === "right"
        ? x - width
        : (fallbackLeftX ?? x)
  const lineY = decoration === "underline" ? y + fontSize * 0.92 : y + fontSize * 0.52
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
  offsetY: number,
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
  radius: number,
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
  imageCache?: Map<string, HTMLImageElement>,
): void {
  const { width, height } = theme.resolution
  const bg = theme.background

  switch (bg.type) {
    case "solid":
      ctx.fillStyle = bg.color
      ctx.fillRect(0, 0, width, height)
      break

    case "gradient": {
      if (!bg.gradient) break
      let grad: CanvasGradient

      if (bg.gradient.type === "linear") {
        const angle = (bg.gradient.angle * Math.PI) / 180
        const cx = width / 2
        const cy = height / 2
        const len = Math.sqrt(width * width + height * height) / 2
        grad = ctx.createLinearGradient(
          cx - Math.cos(angle) * len,
          cy - Math.sin(angle) * len,
          cx + Math.cos(angle) * len,
          cy + Math.sin(angle) * len,
        )
      } else {
        grad = ctx.createRadialGradient(
          width / 2,
          height / 2,
          0,
          width / 2,
          height / 2,
          Math.max(width, height) / 2,
        )
      }

      for (const stop of bg.gradient.stops) {
        grad.addColorStop(stop.position / 100, stop.color)
      }

      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width, height)
      break
    }

    case "image": {
      if (!bg.image) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)
        break
      }
      const img = imageCache?.get(bg.image.url)
      if (!img) {
        // Use a deterministic fallback while image is still loading.
        ctx.fillStyle = bg.image.tint ?? "#000"
        ctx.fillRect(0, 0, width, height)
        break
      }

      ctx.save()

      if (bg.image.blur > 0) {
        ctx.filter = `blur(${bg.image.blur}px) brightness(${bg.image.brightness / 100})`
      } else if (bg.image.brightness !== 100) {
        ctx.filter = `brightness(${bg.image.brightness / 100})`
      }

      let drawX = 0
      let drawY = 0
      let drawW = width
      let drawH = height

      const imgRatio = img.naturalWidth / img.naturalHeight
      const canvasRatio = width / height

      switch (bg.image.fit) {
        case "cover":
          if (imgRatio > canvasRatio) {
            drawH = height
            drawW = height * imgRatio
            drawX = (width - drawW) / 2
          } else {
            drawW = width
            drawH = width / imgRatio
            drawY = (height - drawH) / 2
          }
          break
        case "contain":
          if (imgRatio > canvasRatio) {
            drawW = width
            drawH = width / imgRatio
            drawY = (height - drawH) / 2
          } else {
            drawH = height
            drawW = height * imgRatio
            drawX = (width - drawW) / 2
          }
          break
        case "stretch":
          break
      }

      ctx.drawImage(img, drawX, drawY, drawW, drawH)
      ctx.restore()

      if (bg.image.tint) {
        ctx.fillStyle = bg.image.tint
        ctx.fillRect(0, 0, width, height)
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
  y: number,
): number {
  const ref = theme.reference
  const transformed = applyTextTransform(
    ref.uppercase ? text.toUpperCase() : text,
    resolveTextTransform(ref.textTransform),
  )
  const refAlign = resolveHorizontalAlign(ref.horizontalAlign, theme.layout.textAlign, false)
  const refDecoration = resolveTextDecoration(ref.textDecoration)

  ctx.save()
  ctx.font = `${ref.fontWeight} ${ref.fontSize}px "${ref.fontFamily}", sans-serif`
  ctx.fillStyle = ref.color
  ctx.textBaseline = "top"

  if (ref.letterSpacing > 0) {
    try { ctx.letterSpacing = `${ref.letterSpacing}px` } catch { /* unsupported in some WebViews */ }
  }

  const canvasAlign = refAlign === "justify" ? "left" : refAlign
  ctx.textAlign = canvasAlign
  const x = alignX(canvasAlign, textRectX, textRectWidth)
  ctx.fillText(transformed, x, y)
  const drawnWidth = Math.min(textRectWidth, Math.max(1, ctx.measureText(transformed).width))
  drawTextDecorationLine(ctx, refDecoration, ref.color, refAlign, x, y, drawnWidth, ref.fontSize, textRectX)
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
): number {
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const verseAlign = resolveHorizontalAlign(vt.horizontalAlign, theme.layout.textAlign, true)
  const verseDecoration = resolveTextDecoration(vt.textDecoration)
  const lineHeightPx = vt.fontSize * vt.lineHeight

  ctx.save()
  ctx.font = `${vt.fontWeight} ${vt.fontSize}px "${vt.fontFamily}", serif`
  ctx.fillStyle = vt.color
  ctx.textBaseline = "top"
  ctx.textAlign = verseAlign === "justify" ? "left" : verseAlign

  if (vt.letterSpacing > 0) {
    try { ctx.letterSpacing = `${vt.letterSpacing}px` } catch { /* unsupported in some WebViews */ }
  }

  // Build full text with verse numbers inline
  let fullText = ""
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined) {
      fullText += `${segment.verseNumber} `
    }
    fullText += segment.text + " "
  }
  fullText = applyTextTransform(fullText.trim(), resolveTextTransform(vt.textTransform))

  const wrappedLines = wrapText(ctx, fullText, textRectWidth)

  let currentY = startY
  const x = alignX(verseAlign === "justify" ? "left" : verseAlign, textRectX, textRectWidth)

  const drawStyledLine = (line: string, drawX: number, drawY: number) => {
    if (vt.shadow) {
      ctx.save()
      ctx.shadowColor = vt.shadow.color
      ctx.shadowBlur = vt.shadow.blur
      ctx.shadowOffsetX = vt.shadow.x
      ctx.shadowOffsetY = vt.shadow.y
      ctx.fillText(line, drawX, drawY)
      ctx.restore()
    }

    if (vt.outline) {
      ctx.save()
      ctx.strokeStyle = vt.outline.color
      ctx.lineWidth = vt.outline.width
      ctx.strokeText(line, drawX, drawY)
      ctx.restore()
    }

    if (!vt.shadow) {
      ctx.fillText(line, drawX, drawY)
    }
  }

  for (const [index, line] of wrappedLines.entries()) {
    const isJustifiedLine = verseAlign === "justify" && index < wrappedLines.length - 1 && /\s+/.test(line)
    if (isJustifiedLine) {
      const words = line.trim().split(/\s+/).filter(Boolean)
      if (words.length > 1) {
        const wordsWidth = words.reduce((sum, word) => sum + ctx.measureText(word).width, 0)
        const gap = (textRectWidth - wordsWidth) / (words.length - 1)
        let cursorX = textRectX
        for (const word of words) {
          drawStyledLine(word, cursorX, currentY)
          cursorX += ctx.measureText(word).width + gap
        }
      } else {
        drawStyledLine(line, textRectX, currentY)
      }
      drawTextDecorationLine(
        ctx,
        verseDecoration,
        vt.color,
        "left",
        textRectX,
        currentY,
        textRectWidth,
        vt.fontSize,
        textRectX,
      )
    } else {
      drawStyledLine(line, x, currentY)
      const lineWidth = Math.min(textRectWidth, Math.max(1, ctx.measureText(line).width))
      drawTextDecorationLine(
        ctx,
        verseDecoration,
        vt.color,
        verseAlign,
        x,
        currentY,
        lineWidth,
        vt.fontSize,
        textRectX,
      )
    }
    currentY += lineHeightPx
  }

  ctx.restore()

  return currentY - startY
}

function buildScaledTheme(theme: BroadcastTheme, scale: number): BroadcastTheme {
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
    resolution: { width: theme.resolution.width * scale, height: theme.resolution.height * scale },
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
        ? { ...theme.verseText.outline, width: theme.verseText.outline.width * scale }
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

function measureVerseHeight(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData,
  textRectWidth: number,
): { height: number; maxLineWidth: number } {
  const vt = theme.verseText
  const vn = theme.verseNumbers
  const verseAlign = resolveHorizontalAlign(vt.horizontalAlign, theme.layout.textAlign, true)
  const lineHeightPx = vt.fontSize * vt.lineHeight
  ctx.save()
  ctx.font = `${vt.fontWeight} ${vt.fontSize}px "${vt.fontFamily}", serif`
  if (vt.letterSpacing > 0) {
    try { ctx.letterSpacing = `${vt.letterSpacing}px` } catch { /* unsupported in some WebViews */ }
  }
  let fullText = ""
  for (const segment of verse.segments) {
    if (vn.visible && segment.verseNumber !== undefined) fullText += `${segment.verseNumber} `
    fullText += `${segment.text} `
  }
  const transformed = applyTextTransform(fullText.trim(), resolveTextTransform(vt.textTransform))
  const lines = wrapText(ctx, transformed, textRectWidth)
  let maxLineWidth = 0
  for (const [index, line] of lines.entries()) {
    const isJustifiedLine = verseAlign === "justify" && index < lines.length - 1 && /\s+/.test(line)
    const width = isJustifiedLine ? textRectWidth : ctx.measureText(line).width
    if (width > maxLineWidth) maxLineWidth = width
  }
  ctx.restore()
  return {
    height: Math.max(lineHeightPx, lines.length * lineHeightPx),
    maxLineWidth: Math.max(1, maxLineWidth),
  }
}

function rectForAlignedText(
  align: BroadcastTheme["layout"]["textAlign"],
  drawX: number,
  drawY: number,
  width: number,
  height: number,
  textRect: VerseLayoutRect,
): VerseLayoutRect {
  let x = drawX
  if (align === "center") x = drawX - width / 2
  if (align === "right") x = drawX - width
  const clampedX = Math.max(textRect.x, Math.min(x, textRect.x + textRect.width - width))
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
  options?: RenderOptions,
): VerseLayoutMetrics {
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
  const pos = anchorPosition(
    layout.anchor,
    textAreaW,
    textAreaH,
    canvasW,
    canvasH,
    globalOffsetX,
    globalOffsetY,
  )

  const pad = layout.padding
  const textRectX = pos.x + pad.left
  const textRectY = pos.y + pad.top
  const textRectW = textAreaW - pad.left - pad.right
  const textRectH = textAreaH - pad.top - pad.bottom
  const textAreaRect: VerseLayoutRect = { x: pos.x, y: pos.y, width: textAreaW, height: textAreaH }
  const textRect: VerseLayoutRect = { x: textRectX, y: textRectY, width: textRectW, height: textRectH }

  if (!verse) {
    return { scaledTheme, textAreaRect, textRect, referenceRect: null, verseRect: null }
  }

  const referenceHeight = scaledTheme.reference.fontSize * 1.5
  const verseAlign = resolveHorizontalAlign(
    scaledTheme.verseText.horizontalAlign,
    scaledTheme.layout.textAlign,
    true,
  )
  const referenceAlign = resolveHorizontalAlign(
    scaledTheme.reference.horizontalAlign,
    scaledTheme.layout.textAlign,
    false,
  )
  const blockVerticalAlign = resolveVerticalAlign(
    scaledTheme.reference.position === "above"
      ? (scaledTheme.reference.verticalAlign ?? scaledTheme.verseText.verticalAlign)
      : (scaledTheme.verseText.verticalAlign ?? scaledTheme.reference.verticalAlign),
  )
  const referenceGap = Math.max(
    0,
    scaledTheme.layout.referenceGap ?? scaledTheme.reference.fontSize * 0.5,
  )
  const verseMetrics = measureVerseHeight(ctx, scaledTheme, verse, textRectW)
  const verseHeight = verseMetrics.height
  const verseDrawX = alignX(verseAlign === "justify" ? "left" : verseAlign, textRectX, textRectW)
  const referenceDrawX = alignX(referenceAlign === "justify" ? "left" : referenceAlign, textRectX, textRectW)

  const refText = applyTextTransform(
    scaledTheme.reference.uppercase ? verse.reference.toUpperCase() : verse.reference,
    resolveTextTransform(scaledTheme.reference.textTransform),
  )
  ctx.save()
  ctx.font = `${scaledTheme.reference.fontWeight} ${scaledTheme.reference.fontSize}px "${scaledTheme.reference.fontFamily}", sans-serif`
  const referenceWidth = Math.max(1, Math.min(textRectW, ctx.measureText(refText).width))
  ctx.restore()

  const blockHeight = scaledTheme.reference.position === "above"
    ? referenceHeight + verseHeight
    : scaledTheme.reference.position === "below"
      ? verseHeight + referenceGap + referenceHeight
      : verseHeight + referenceHeight
  const blockStartY = alignY(blockVerticalAlign, textRectY, textRectH, blockHeight)

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
      textRect,
    )
    verseRect = rectForAlignedText(
      verseAlign === "justify" ? "left" : verseAlign,
      verseDrawX,
      verseY,
      verseMetrics.maxLineWidth,
      verseHeight,
      textRect,
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
      textRect,
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect,
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
      textRect,
    )
    referenceRect = rectForAlignedText(
      referenceAlign === "justify" ? "left" : referenceAlign,
      referenceDrawX,
      refY,
      referenceWidth,
      referenceHeight,
      textRect,
    )
  }

  return { scaledTheme, textAreaRect, textRect, referenceRect, verseRect }
}

export function renderVerse(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  verse: VerseRenderData | null,
  options?: RenderOptions,
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
  options?: RenderOptions,
): VerseLayoutMetrics {
  const metrics = computeVerseLayoutMetrics(ctx, theme, verse, options)
  const scaledTheme = metrics.scaledTheme

  ctx.save()

  // Apply global opacity
  if (options?.opacity !== undefined) {
    ctx.globalAlpha = options.opacity
  }

  // Draw background
  drawBackground(ctx, scaledTheme, options?.imageCache)

  // Draw text box if enabled
  if (scaledTheme.textBox.enabled) {
    ctx.save()
    ctx.globalAlpha = (options?.opacity ?? 1) * scaledTheme.textBox.opacity
    ctx.fillStyle = scaledTheme.textBox.color
    roundRect(
      ctx,
      metrics.textAreaRect.x,
      metrics.textAreaRect.y,
      metrics.textAreaRect.width,
      metrics.textAreaRect.height,
      scaledTheme.textBox.borderRadius,
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
  if (verseRect) {
    drawVerseText(
      ctx,
      scaledTheme,
      verse,
      metrics.textRect.x,
      metrics.textRect.width,
      verseRect.y,
    )
  }
  if (referenceRect) {
    drawReference(
      ctx,
      scaledTheme,
      verse.reference,
      metrics.textRect.x,
      metrics.textRect.width,
      referenceRect.y,
    )
  }

  ctx.restore()
  return metrics
}
