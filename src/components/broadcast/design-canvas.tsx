import { useEffect, useRef, useState, useCallback } from "react"
import * as fabric from "fabric"
import { useBroadcastStore } from "@/stores"
import {
  onThemeFontsLoaded,
  renderVerse,
  type VerseLayoutMetrics,
} from "@/lib/verse-renderer"
import { seedFreeBoxesFromMetrics, SAMPLE_VERSE } from "@/lib/theme-migrations"
import { Button } from "@/components/ui/button"
import {
  SearchIcon,
  PlusIcon,
  MinusIcon,
  MousePointer2Icon,
  Grid3X3Icon,
  MaximizeIcon,
} from "lucide-react"
import type { BroadcastTheme } from "@/types"

const WS_WIDTH = 1920
const WS_HEIGHT = 1080

export function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const latestThemeRef = useRef<BroadcastTheme | null>(null)
  const rafIdRef = useRef<number | null>(null)
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const imageRequestsRef = useRef<Map<string, Promise<HTMLImageElement>>>(new Map())
  const objectsRef = useRef<{
    workspace: fabric.Rect | null
    referenceRegion: fabric.Rect | null
    verseRegion: fabric.Rect | null
  }>({ workspace: null, referenceRegion: null, verseRegion: null })
  const draggingRef = useRef<"reference" | "verse" | null>(null)
  const latestMetricsRef = useRef<VerseLayoutMetrics | null>(null)

  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const editingThemeId = useBroadcastStore((s) => s.editingThemeId)
  const selectedElement = useBroadcastStore((s) => s.selectedElement)
  const [zoomLevel, setZoomLevel] = useState(0)

  const resyncLatestTheme = useCallback(() => {
    const latestTheme = latestThemeRef.current
    const canvas = fabricRef.current
    if (!latestTheme || !canvas) return
    void syncThemeToCanvas(
      latestTheme,
      objectsRef,
      canvas,
      imageCacheRef.current,
      imageRequestsRef.current,
      undefined,
      latestMetricsRef,
      draggingRef.current
    )
  }, [])

  // Auto-zoom: fit workspace into container
  const autoZoom = useCallback(() => {
    const canvas = fabricRef.current
    const container = containerRef.current
    const workspace = objectsRef.current.workspace
    if (!canvas || !container || !workspace) return

    const cw = container.offsetWidth
    const ch = container.offsetHeight
    canvas.setDimensions({ width: cw, height: ch })

    // Reset viewport
    const identity: fabric.TMat2D = [1, 0, 0, 1, 0, 0]
    canvas.setViewportTransform(identity)

    // Calculate zoom to fit workspace with padding
    const scale = fabric.util.findScaleToFit(workspace, { width: cw, height: ch }) * 0.85
    canvas.setZoom(scale)

    // Center the workspace
    const wsCenter = workspace.getCenterPoint()
    const vpTransform = canvas.viewportTransform!
    vpTransform[4] = cw / 2 - wsCenter.x * vpTransform[0]
    vpTransform[5] = ch / 2 - wsCenter.y * vpTransform[3]
    canvas.setViewportTransform(vpTransform)
    canvas.requestRenderAll()
    resyncLatestTheme()

    setZoomLevel(Math.round(scale * 100))
  }, [resyncLatestTheme])

  // Initialize Fabric canvas + workspace
  useEffect(() => {
    if (!canvasElRef.current || !containerRef.current || !editingThemeId) return

    const canvas = new fabric.Canvas(canvasElRef.current, {
      backgroundColor: "#18181b",
      controlsAboveOverlay: true,
    })

    // Set canvas to container size
    const cw = containerRef.current.offsetWidth
    const ch = containerRef.current.offsetHeight
    canvas.setDimensions({ width: cw, height: ch })

    // Create workspace rect (the 1920x1080 "page")
    const workspace = new fabric.Rect({
      width: WS_WIDTH,
      height: WS_HEIGHT,
      fill: "white",
      selectable: false,
      hasControls: false,
      hoverCursor: "default",
      shadow: new fabric.Shadow({ color: "rgba(0,0,0,0.4)", blur: 20 }),
    })
    canvas.add(workspace)
    canvas.centerObject(workspace)
    workspace.setCoords()
    canvas.clipPath = workspace
    objectsRef.current.workspace = workspace

    const refRegion = new fabric.Rect({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: 100,
      height: 40,
      fill: "rgba(0,0,0,0.001)",
      selectable: true,
      hasControls: false,
      hasBorders: true,
      borderColor: "#f59e0b",
      borderDashArray: [6, 3],
      lockMovementX: false,
      lockMovementY: false,
      evented: true,
      objectCaching: false,
    })
    canvas.add(refRegion)
    objectsRef.current.referenceRegion = refRegion

    const verseRegion = new fabric.Rect({
      left: 0,
      top: 0,
      originX: "left",
      originY: "top",
      width: 100,
      height: 200,
      fill: "rgba(0,0,0,0.001)",
      selectable: true,
      hasControls: false,
      hasBorders: true,
      borderColor: "#f59e0b",
      borderDashArray: [6, 3],
      lockMovementX: false,
      lockMovementY: false,
      evented: true,
      objectCaching: false,
    })
    canvas.add(verseRegion)
    objectsRef.current.verseRegion = verseRegion

    // Selection events
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0]
      if (obj === objectsRef.current.referenceRegion) {
        useBroadcastStore.getState().setSelectedElement("reference")
      } else if (obj === objectsRef.current.verseRegion) {
        useBroadcastStore.getState().setSelectedElement("verse")
      }
    })
    canvas.on("selection:updated", (e) => {
      const obj = e.selected?.[0]
      if (obj === objectsRef.current.referenceRegion) {
        useBroadcastStore.getState().setSelectedElement("reference")
      } else if (obj === objectsRef.current.verseRegion) {
        useBroadcastStore.getState().setSelectedElement("verse")
      }
    })
    canvas.on("selection:cleared", () => {
      useBroadcastStore.getState().setSelectedElement(null)
    })

    // Drag-to-position: moving a region writes its box back to the draft
    // theme. Dragging while in stacked mode detaches into free mode first,
    // seeding boxes from the current stacked layout so nothing jumps.
    const regionForObject = (obj: fabric.Object | undefined) =>
      obj === objectsRef.current.referenceRegion
        ? ("reference" as const)
        : obj === objectsRef.current.verseRegion
          ? ("verse" as const)
          : null

    canvas.on("object:moving", (e) => {
      const region = regionForObject(e.target)
      if (!region) return
      draggingRef.current = region

      const store = useBroadcastStore.getState()
      let theme = store.draftTheme
      if (!theme) return
      if (
        theme.layout.mode !== "free" ||
        !theme.layout.referenceBox ||
        !theme.layout.verseBox
      ) {
        const metrics = latestMetricsRef.current
        const seeded = metrics
          ? seedFreeBoxesFromMetrics(metrics, theme.resolution)
          : null
        if (!seeded) return
        store.updateDraft({ layout: { ...theme.layout, mode: "free", ...seeded } })
        theme = useBroadcastStore.getState().draftTheme
        if (!theme) return
      }

      const ws = objectsRef.current.workspace
      const obj = e.target
      if (!ws || !obj) return
      const wsTopLeft = ws.getPointByOrigin("left", "top")
      const key = region === "reference" ? "referenceBox" : "verseBox"
      const box = theme.layout[key]
      if (!box) return
      const widthPx = (box.width / 100) * WS_WIDTH
      const heightPx = (box.height / 100) * WS_HEIGHT
      const localX = clamp(obj.left - wsTopLeft.x, 0, Math.max(0, WS_WIDTH - widthPx))
      const localY = clamp(obj.top - wsTopLeft.y, 0, Math.max(0, WS_HEIGHT - heightPx))
      store.updateDraftNested(`layout.${key}`, {
        ...box,
        x: Math.round((localX / WS_WIDTH) * 10000) / 100,
        y: Math.round((localY / WS_HEIGHT) * 10000) / 100,
      })
    })

    const endDrag = () => {
      if (!draggingRef.current) return
      draggingRef.current = null
      resyncLatestTheme()
    }
    canvas.on("object:modified", endDrag)
    canvas.on("mouse:up", endDrag)

    fabricRef.current = canvas

    // Auto-zoom after a tick (canvas needs to be in DOM)
    requestAnimationFrame(() => {
      autoZoom()
    })

    // ResizeObserver for auto-zoom on container resize
    const observer = new ResizeObserver(() => autoZoom())
    observer.observe(containerRef.current)

    // Re-render once theme webfonts load — text measured against fallback
    // fonts before that would leave the bitmap and hit rects off.
    const unsubscribeFonts = onThemeFontsLoaded(() => resyncLatestTheme())

    return () => {
      unsubscribeFonts()
      observer.disconnect()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
      void canvas.dispose()
      fabricRef.current = null
      objectsRef.current = { workspace: null, referenceRegion: null, verseRegion: null }
    }
  }, [editingThemeId, autoZoom, resyncLatestTheme])

  // Sync draft theme to the existing Fabric objects (throttled to 1 per frame)
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas || !draftTheme) return
    latestThemeRef.current = draftTheme

    if (rafIdRef.current) return // already scheduled
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const latest = latestThemeRef.current
      const latestCanvas = fabricRef.current
      if (!latest || !latestCanvas) return
      void syncThemeToCanvas(
        latest,
        objectsRef,
        latestCanvas,
        imageCacheRef.current,
        imageRequestsRef.current,
        () => {
          const current = latestThemeRef.current
          const currentCanvas = fabricRef.current
          if (!current || !currentCanvas) return
          void syncThemeToCanvas(
            current,
            objectsRef,
            currentCanvas,
            imageCacheRef.current,
            imageRequestsRef.current,
            undefined,
            latestMetricsRef,
            draggingRef.current
          )
        },
        latestMetricsRef,
        draggingRef.current
      )
    })
  }, [draftTheme])

  useEffect(() => {
    const refRegion = objectsRef.current.referenceRegion
    const verseRegion = objectsRef.current.verseRegion
    if (!refRegion || !verseRegion) return
    refRegion.set({ strokeWidth: selectedElement === "reference" ? 1 : 0 })
    verseRegion.set({ strokeWidth: selectedElement === "verse" ? 1 : 0 })
    fabricRef.current?.requestRenderAll()
  }, [selectedElement])

  const zoomIn = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const newZoom = Math.min(canvas.getZoom() * 1.1, 3)
    canvas.setZoom(newZoom)
    canvas.requestRenderAll()
    resyncLatestTheme()
    setZoomLevel(Math.round(newZoom * 100))
  }, [resyncLatestTheme])

  const zoomOut = useCallback(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const newZoom = Math.max(canvas.getZoom() * 0.9, 0.1)
    canvas.setZoom(newZoom)
    canvas.requestRenderAll()
    resyncLatestTheme()
    setZoomLevel(Math.round(newZoom * 100))
  }, [resyncLatestTheme])

  const elementLabel =
    selectedElement === "verse" ? "verse"
      : selectedElement === "reference" ? "reference"
        : "none"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/40 px-3" style={{ background: "#18181b" }}>
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
          <MousePointer2Icon className="size-3.5" />
        </Button>
        <div className="flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
          <Grid3X3Icon className="size-3" />
          <span>Grid</span>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" className="text-muted-foreground">
          <SearchIcon className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center text-[0.625rem] font-medium tabular-nums text-muted-foreground">
          {zoomLevel}%
        </span>
        <Button variant="ghost" size="icon-xs" onClick={zoomOut} className="text-muted-foreground">
          <MinusIcon className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={zoomIn} className="text-muted-foreground">
          <PlusIcon className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={autoZoom} className="text-muted-foreground">
          <MaximizeIcon className="size-3.5" />
        </Button>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasElRef} />
        {!draftTheme && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#18181b" }}>
            <p className="text-xs text-muted-foreground">Select a theme to begin editing</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex h-8 shrink-0 items-center border-t border-border/40 px-3 text-[0.5625rem] text-muted-foreground/70" style={{ background: "#18181b" }}>
        <span>Output: {WS_WIDTH} × {WS_HEIGHT}px</span>
        <span className="mx-2">·</span>
        <span>Zoom: {zoomLevel}%</span>
        <span className="mx-2">·</span>
        <span>Scroll to pan, pinch/Ctrl+scroll to zoom</span>
        <span className="mx-2">·</span>
        <span>
          {selectedElement ? (
            <>Editing: <span className="font-medium text-primary">{elementLabel}</span></>
          ) : (
            "Click frame to select"
          )}
        </span>
      </div>
    </div>
  )
}

/** Sync BroadcastTheme properties to existing Fabric objects */
async function syncThemeToCanvas(
  theme: BroadcastTheme,
  objectsRef: React.MutableRefObject<{
    workspace: fabric.Rect | null
    referenceRegion: fabric.Rect | null
    verseRegion: fabric.Rect | null
  }>,
  canvas: fabric.Canvas,
  imageCache: Map<string, HTMLImageElement>,
  imageRequests: Map<string, Promise<HTMLImageElement>>,
  onImageReady?: () => void,
  metricsRef?: React.MutableRefObject<VerseLayoutMetrics | null>,
  dragging?: "reference" | "verse" | null
) {
  const ws = objectsRef.current.workspace
  const refRegion = objectsRef.current.referenceRegion
  const verseRegion = objectsRef.current.verseRegion
  if (!ws || !refRegion || !verseRegion) return

  if (theme.background.type === "image" && theme.background.image?.url) {
    const img = imageCache.get(theme.background.image.url)
    if (!img) {
      ensureImage(
        theme.background.image.url,
        imageCache,
        imageRequests,
        onImageReady
      )
    }
  }

  const { bitmap, metrics } = renderThemeBitmap(theme, imageCache)
  ws.set({
    fill: new fabric.Pattern({
      source: bitmap,
      repeat: "no-repeat",
    }),
  })

  if (!metrics) return
  if (metricsRef) metricsRef.current = metrics
  const referenceRect = metrics.referenceRect
  const verseRect = metrics.verseRect
  if (!referenceRect || !verseRect) return

  ws.setCoords()
  const wsTopLeft = ws.getPointByOrigin("left", "top")
  // In free mode the regions ARE the layout boxes, so map them 1:1 for an
  // exact drag round-trip. In stacked mode the renderer's element rects
  // already wrap the drawn text.
  const freeMode =
    theme.layout.mode === "free" &&
    metrics.referenceBoxRect &&
    metrics.verseBoxRect
  const hitRects = freeMode
    ? {
        referenceRect: metrics.referenceBoxRect!,
        verseRect: metrics.verseBoxRect!,
      }
    : { referenceRect, verseRect }
  const mappedReferenceRect = mapLocalRectToWorkspaceRect(hitRects.referenceRect, wsTopLeft)
  const mappedVerseRect = mapLocalRectToWorkspaceRect(hitRects.verseRect, wsTopLeft)

  if (dragging !== "reference") {
    refRegion.set({
      originX: "left",
      originY: "top",
      width: Math.max(24, mappedReferenceRect.width),
      height: Math.max(20, mappedReferenceRect.height),
    })
    refRegion.setPositionByOrigin(
      new fabric.Point(mappedReferenceRect.x, mappedReferenceRect.y),
      "left",
      "top"
    )
  }
  if (dragging !== "verse") {
    verseRegion.set({
      originX: "left",
      originY: "top",
      width: Math.max(24, mappedVerseRect.width),
      height: Math.max(24, mappedVerseRect.height),
    })
    verseRegion.setPositionByOrigin(
      new fabric.Point(mappedVerseRect.x, mappedVerseRect.y),
      "left",
      "top"
    )
  }
  canvas.bringObjectToFront(verseRegion)
  canvas.bringObjectToFront(refRegion)

  const selected = useBroadcastStore.getState().selectedElement
  refRegion.set({ strokeWidth: selected === "reference" ? 1 : 0 })
  verseRegion.set({ strokeWidth: selected === "verse" ? 1 : 0 })
  refRegion.setCoords()
  verseRegion.setCoords()

  canvas.requestRenderAll()
}

function mapLocalRectToWorkspaceRect(
  localRect: { x: number; y: number; width: number; height: number },
  wsTopLeft: fabric.Point
) {
  const clampedWidth = clamp(localRect.width, 0, WS_WIDTH)
  const clampedHeight = clamp(localRect.height, 0, WS_HEIGHT)
  const localX = clamp(localRect.x, 0, Math.max(0, WS_WIDTH - clampedWidth))
  const localY = clamp(localRect.y, 0, Math.max(0, WS_HEIGHT - clampedHeight))

  return {
    x: wsTopLeft.x + localX,
    y: wsTopLeft.y + localY,
    width: clampedWidth,
    height: clampedHeight,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function ensureImage(
  url: string,
  cache: Map<string, HTMLImageElement>,
  pending: Map<string, Promise<HTMLImageElement>>,
  onReady?: () => void
) {
  if (cache.has(url) || pending.has(url)) return
  const request = loadImage(url)
    .then((img) => {
      cache.set(url, img)
      onReady?.()
      return img
    })
    .catch((error) => {
      console.warn("[theme-designer] failed to load background image", { url: url.slice(0, 100), error })
      throw error
    })
    .finally(() => {
      pending.delete(url)
    })
  pending.set(url, request)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

function renderThemeBitmap(
  theme: BroadcastTheme,
  imageCache: Map<string, HTMLImageElement>
): { bitmap: HTMLCanvasElement; metrics: ReturnType<typeof renderVerse> } {
  const offscreen = document.createElement("canvas")
  offscreen.width = WS_WIDTH
  offscreen.height = WS_HEIGHT
  const ctx = offscreen.getContext("2d")
  if (!ctx) return { bitmap: offscreen, metrics: null }

  const metrics = renderVerse(ctx, theme, SAMPLE_VERSE, { imageCache })
  return { bitmap: offscreen, metrics }
}
