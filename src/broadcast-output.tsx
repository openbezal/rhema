import { createRoot } from "react-dom/client"
import { useRef, useEffect, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { onThemeFontsLoaded, renderVerse } from "@/lib/verse-renderer"
import { preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { normalizeTheme } from "@/lib/theme-migrations"
import "./broadcast-fonts.css"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"
import type { NdiConfigEventPayload, NdiFrameRequest } from "@/types"

/** Convert Uint8Array/Uint8ClampedArray to base64 using Function.apply (avoids spread stack overflow) */
function uint8ToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  const CHUNK = 0x8000 // 32KB — safe for Function.apply
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(
      String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK) as unknown as number[],
      ),
    )
  }
  return btoa(parts.join(""))
}

/** Read output ID from URL query param (?output=main or ?output=alt). Defaults to "main". */
const OUTPUT_ID = new URLSearchParams(window.location.search).get("output") ?? "main"

interface BroadcastPayload {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  idleFadeMs?: number
}

/** Fallback if a payload arrives without idleFadeMs (older event shape).
 * Kept in sync with the Idle Fade Timeout default in settings-store.ts. */
const DEFAULT_IDLE_FADE_MS = 30_000
const FADE_DURATION_MS = 800

function BroadcastCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const latestData = useRef<BroadcastPayload | null>(null)
  const ndiConfigRef = useRef<NdiConfigEventPayload>({
    active: false,
    fps: 24,
    width: 1920,
    height: 1080,
  })
  const ndiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastPushRef = useRef(0)
  const pushingRef = useRef(false)
  const alphaRef = useRef(1)
  const targetAlphaRef = useRef(1)
  const rafRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // presentedAt of the verse the fade timer was last armed for; undefined =
  // nothing shown. Only a CHANGED stamp re-arms the timer, so incidental
  // re-emits (theme edits, output syncs) can't keep a stale verse alive.
  const lastPresentStampRef = useRef<number | null | undefined>(undefined)
  const pushNdiBurstRef = useRef<(() => void) | null>(null)

  const logDebug = useCallback((message: string, meta?: unknown) => {
    if (!import.meta.env.DEV) return
    if (meta === undefined) {
      console.debug(`[broadcast-output] ${message}`)
      return
    }
    console.debug(`[broadcast-output] ${message}`, meta)
  }, [])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const data = latestData.current
    if (!data) {
      // Black screen when no data
      ctx.globalAlpha = 1
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      return
    }

    const { theme, verse } = data
    canvas.width = theme.resolution.width
    canvas.height = theme.resolution.height

    // Clear to black at full opacity first, then draw the scene at the
    // current fade alpha, so fading blends toward black rather than
    // ghosting over whatever the canvas previously held.
    ctx.globalAlpha = 1
    ctx.fillStyle = "#000"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = alphaRef.current

    const result = renderVerse(ctx, theme, verse, {
      scale: 1,
      imageCache: themeImageCache(),
    })
    ctx.globalAlpha = 1
    if (!result) {
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      logDebug("renderVerse returned null; drew fallback frame")
    }
  }, [logDebug])

  // Animate alphaRef toward targetAlphaRef, redrawing each frame. Reads
  // targetAlphaRef live on every tick, so retargeting mid-fade (e.g. a new
  // verse arrives while fading out) smoothly reverses direction instead of
  // finishing the stale animation first.
  const animateFade = useCallback(() => {
    if (rafRef.current !== null) return // loop already running
    lastFrameTimeRef.current = null

    const step = (now: number) => {
      const last = lastFrameTimeRef.current ?? now
      const dt = now - last
      lastFrameTimeRef.current = now

      const target = targetAlphaRef.current
      const diff = target - alphaRef.current
      if (Math.abs(diff) < 0.01) {
        alphaRef.current = target
        draw()
        rafRef.current = null
        lastFrameTimeRef.current = null
        return
      }

      alphaRef.current += (dt / FADE_DURATION_MS) * diff
      draw()
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [draw])

  const setFadeTarget = useCallback(
    (target: number) => {
      targetAlphaRef.current = target
      animateFade()
    },
    [animateFade]
  )

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const armIdleTimer = useCallback(
    (idleFadeMs: number) => {
      clearIdleTimer()
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null
        logDebug("Idle timeout reached; fading display to black")
        setFadeTarget(0)
      }, idleFadeMs)
    },
    [clearIdleTimer, logDebug, setFadeTarget]
  )

  // Redraw once a theme's images land. The burst matters: without it NDI
  // receivers keep the flat fallback frame until the 2s keepalive fires.
  const preloadThemeAssets = useCallback((theme: BroadcastTheme) => {
    preloadThemeImages(theme, () => {
      logDebug("Theme images loaded")
      draw()
      pushNdiBurstRef.current?.()
    })
  }, [draw, logDebug])

  const pushNdiFrame = useCallback(async () => {
    if (!ndiConfigRef.current.active) return
    if (pushingRef.current) return // back-pressure: skip if already pushing
    pushingRef.current = true

    try {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const targetWidth = ndiConfigRef.current.width
      const targetHeight = ndiConfigRef.current.height

      let sourceCtx = ctx
      let sourceWidth = canvas.width
      let sourceHeight = canvas.height

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        const ndiCanvas = ndiCanvasRef.current ?? document.createElement("canvas")
        ndiCanvas.width = targetWidth
        ndiCanvas.height = targetHeight
        const ndiCtx = ndiCanvas.getContext("2d")
        if (!ndiCtx) return
        ndiCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight)
        ndiCanvasRef.current = ndiCanvas
        sourceCtx = ndiCtx
        sourceWidth = targetWidth
        sourceHeight = targetHeight
      }

      const imageData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight)
      const rgbaBase64 = uint8ToBase64(imageData.data)

      const request: NdiFrameRequest = {
        outputId: OUTPUT_ID,
        width: sourceWidth,
        height: sourceHeight,
        rgbaBase64,
      }

      await invoke("push_ndi_frame", { request })
      lastPushRef.current = Date.now()
    } catch (error) {
      console.warn("[broadcast-output] push_ndi_frame failed", error)
    } finally {
      pushingRef.current = false
    }
  }, [])

  /** Push a burst of 3 frames after content changes (NDI receivers need a few frames to sync) */
  const pushNdiBurst = useCallback(() => {
    void pushNdiFrame()
    setTimeout(() => void pushNdiFrame(), 150)
    setTimeout(() => void pushNdiFrame(), 300)
  }, [pushNdiFrame])

  // Image loads finish after the burst that followed their theme update, and
  // the preload callback is defined above this — go through a ref so it can
  // re-burst without a definition cycle.
  useEffect(() => {
    pushNdiBurstRef.current = pushNdiBurst
  }, [pushNdiBurst])

  useEffect(() => {
    // Set initial canvas size
    const canvas = canvasRef.current
    if (canvas) {
      canvas.width = 1920
      canvas.height = 1080
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, 1920, 1080)
      }
    }

    const currentWindow = getCurrentWebviewWindow()
    logDebug("Listener registration started", { label: currentWindow.label })
    const unlisten = currentWindow.listen<BroadcastPayload>("broadcast:verse-update", (event) => {
      latestData.current = {
        ...event.payload,
        theme: normalizeTheme(event.payload.theme),
      }
      preloadThemeAssets(event.payload.theme)
      logDebug("Received broadcast:verse-update", {
        hasVerse: Boolean(event.payload.verse),
        themeId: event.payload.theme.id,
      })
      if (event.payload.verse) {
        // A fresh present (new verse, re-detected same verse, or keepalive)
        // carries a new presentedAt stamp — only then fade in and re-arm.
        // An unchanged stamp is an incidental re-emit (theme edit, output
        // sync): redraw, but leave the fade timer running. A missing stamp
        // (older payload shape) always re-arms, matching prior behavior.
        const stamp = event.payload.verse.presentedAt ?? null
        if (stamp === null || stamp !== lastPresentStampRef.current) {
          lastPresentStampRef.current = stamp
          setFadeTarget(1)
          armIdleTimer(event.payload.idleFadeMs ?? DEFAULT_IDLE_FADE_MS)
        }
      } else {
        lastPresentStampRef.current = undefined
        clearIdleTimer()
        setFadeTarget(0)
      }
      draw()
      pushNdiBurst()
    })

    const unlistenNdiConfig = currentWindow.listen<NdiConfigEventPayload>("broadcast:ndi-config", (event) => {
      ndiConfigRef.current = event.payload
      logDebug("Received broadcast:ndi-config", event.payload)
      // Push burst when NDI becomes active
      if (event.payload.active) pushNdiBurst()
    })

    // Request current NDI status on mount (fixes race condition
    // where NDI is started before this window opens)
    void invoke<{ active: boolean; width: number; height: number; fps: number } | null>("get_ndi_status", { outputId: OUTPUT_ID })
      .then((status) => {
        if (status && status.active) {
          ndiConfigRef.current = {
            active: true,
            fps: status.fps,
            width: status.width,
            height: status.height,
          }
          logDebug("Fetched NDI status on mount", status)
        }
      })
      .catch(() => {
        // Command may not exist yet
      })

    // Redraw whenever a theme webfont finishes loading (the renderer requests
    // them on demand) so frames drawn against fallback metrics are replaced.
    const unsubscribeFonts = onThemeFontsLoaded(() => {
      draw()
      pushNdiBurst()
    })

    void currentWindow.emitTo("main", "broadcast:output-ready", { outputId: OUTPUT_ID }).then(() => {
      logDebug("Sent broadcast:output-ready")
    }).catch(() => {
      console.warn("[broadcast-output] failed to send output-ready event")
    })

    return () => {
      unsubscribeFonts()
      unlisten.then((fn) => fn())
      unlistenNdiConfig.then((fn) => fn())
      clearIdleTimer()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [
    draw,
    logDebug,
    preloadThemeAssets,
    pushNdiFrame,
    pushNdiBurst,
    setFadeTarget,
    armIdleTimer,
    clearIdleTimer,
  ])

  // Slow keepalive: push one frame every 2s if idle (prevents NDI receivers from dropping the source)
  useEffect(() => {
    const timer = setInterval(() => {
      if (!ndiConfigRef.current.active) return
      const elapsed = Date.now() - lastPushRef.current
      if (elapsed > 2000) void pushNdiFrame()
    }, 2000)
    return () => clearInterval(timer)
  }, [pushNdiFrame])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100vw",
        height: "100vh",
        display: "block",
        objectFit: "contain",
      }}
    />
  )
}

const root = document.getElementById("broadcast-root")!
createRoot(root).render(<BroadcastCanvas />)
