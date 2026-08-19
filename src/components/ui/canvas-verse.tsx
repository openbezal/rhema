import { useRef, useEffect, useState, useCallback, memo } from "react"
import { onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import type { BroadcastTheme, VerseRenderData } from "@/types"
import { cn } from "@/lib/utils"

interface CanvasVerseProps {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  className?: string
}

export const CanvasVerse = memo(function CanvasVerse({
  theme,
  verse,
  className,
}: CanvasVerseProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Measure container width with ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setContainerWidth(w)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || containerWidth === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const aspectRatio = theme.resolution.width / theme.resolution.height
    const displayW = containerWidth
    const displayH = displayW / aspectRatio

    canvas.width = displayW * dpr
    canvas.height = displayH * dpr
    canvas.style.width = `${displayW}px`
    canvas.style.height = `${displayH}px`

    ctx.scale(dpr, dpr)
    const scale = displayW / theme.resolution.width
    renderVerse(ctx, theme, verse, {
      scale,
      imageCache: themeImageCache(),
    })
  }, [theme, verse, containerWidth])

  // Preload every image the theme uses so the renderer finds them in the cache.
  useEffect(() => {
    preloadThemeImages(theme, draw)
  }, [theme, draw])

  // Redraw whenever theme, verse, or container size changes.
  useEffect(() => {
    draw()
  }, [draw])

  // Redraw once theme webfonts load so early frames drawn against fallback
  // font metrics are corrected.
  useEffect(() => onThemeFontsLoaded(() => draw()), [draw])

  return (
    <div ref={containerRef} className={cn("w-full", className)}>
      <canvas ref={canvasRef} className="w-full rounded-md" />
    </div>
  )
})
