import { createRoot } from "react-dom/client"
import { useRef, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"
import { onThemeFontsLoaded } from "@/lib/verse-renderer"
import { renderPresentationFrame } from "@/lib/presentation-frame"
import { LatestFrameDelivery, type CapturedFrame } from "@/lib/frame-delivery"
import { preloadThemeImages, themeImageCache } from "@/lib/theme-image-cache"
import { markBroadcastTrace, type BroadcastTrace } from "@/lib/broadcast-trace"
import { normalizeTheme } from "@/lib/theme-migrations"
import "./broadcast-fonts.css"
import type {
  BroadcastTheme,
  VerseRenderData,
  OutputClearMode,
} from "@/types/broadcast"
import type {
  NdiConfigEventPayload,
  NdiStatus,
  NdiRendererLease,
} from "@/types/ndi"

const OUTPUT_ID =
  new URLSearchParams(window.location.search).get("output") ?? "main"
interface BroadcastPayload {
  theme: BroadcastTheme
  verse: VerseRenderData | null
  clearMode?: OutputClearMode
  trace?: BroadcastTrace
}

export function BroadcastCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let disposed = false
    let negotiation = 0
    let renderRevision = 0
    let latest: BroadcastPayload | null = null
    let config: NdiRendererLease | null = null
    let scaled: HTMLCanvasElement | null = null
    let renderedTrace:
      (BroadcastTrace & { renderedEpochMs: number }) | undefined
    const canvas = canvasRef.current!
    canvas.width = 1920
    canvas.height = 1080
    const delivery = new LatestFrameDelivery(
      async (frame) => {
        await invoke("push_ndi_frame", frame.pixels, {
          headers: {
            "x-rhema-output": OUTPUT_ID,
            "x-rhema-lease": frame.lease,
            "x-rhema-revision": String(frame.revision),
            "x-rhema-width": String(frame.width),
            "x-rhema-height": String(frame.height),
            ...(frame.trace
              ? {
                  "x-rhema-trace": frame.trace.id,
                  "x-rhema-accepted-ms": String(frame.trace.acceptedEpochMs),
                  "x-rhema-rendered-ms": String(frame.trace.renderedEpochMs),
                }
              : {}),
          },
        })
      },
      (error) =>
        console.warn("[broadcast-output] frame submission failed", error)
    )
    function capture(): CapturedFrame {
      if (!config || disposed) throw new Error("output renderer is inactive")
      let source = canvas
      if (canvas.width !== config.width || canvas.height !== config.height) {
        scaled ??= document.createElement("canvas")
        // Reset the bitmap before drawing, including a transparent terminal frame.
        scaled.width = config.width
        scaled.height = config.height
        const ctx = scaled.getContext("2d")
        if (!ctx) throw new Error("could not create scaled output context")
        ctx.drawImage(canvas, 0, 0, config.width, config.height)
        source = scaled
      }
      const ctx = source.getContext("2d")
      if (!ctx) throw new Error("could not read output context")
      const pixels = ctx.getImageData(0, 0, source.width, source.height).data
      return {
        trace: renderedTrace,
        width: source.width,
        height: source.height,
        pixels: new Uint8Array(
          pixels.buffer,
          pixels.byteOffset,
          pixels.byteLength
        ),
      }
    }
    function draw() {
      if (disposed) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      if (!latest) {
        ctx.fillStyle = "#000000"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else {
        canvas.width = latest.theme.resolution.width
        canvas.height = latest.theme.resolution.height
        renderPresentationFrame(
          ctx,
          latest.theme,
          latest.verse,
          latest.clearMode ?? "background",
          { scale: 1, imageCache: themeImageCache() }
        )
      }
      renderedTrace = latest?.trace
        ? { ...latest.trace, renderedEpochMs: Date.now() }
        : undefined
      if (renderedTrace)
        markBroadcastTrace(renderedTrace, "canvas_rendered", OUTPUT_ID)
      if (latest) delivery.request(++renderRevision, capture)
    }
    async function connect() {
      const ticket = ++negotiation
      config = null
      delivery.stop()
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const status = await invoke<NdiStatus | null>("get_ndi_status", {
            outputId: OUTPUT_ID,
          })
          if (disposed || ticket !== negotiation) return
          if (!status?.active) return
          if (status.frameProtocol !== 1)
            throw new Error("unsupported native frame protocol")
          const lease = await invoke<NdiRendererLease>("begin_ndi_renderer", {
            outputId: OUTPUT_ID,
            generation: status.generation,
            expectedEpoch: status.stats.epoch,
          })
          if (disposed || ticket !== negotiation) return
          config = lease
          renderRevision = 0
          delivery.activate(lease.lease)
          draw()
          return
        } catch (error) {
          if (disposed || ticket !== negotiation) return
          if (attempt === 2)
            console.warn(
              "[broadcast-output] could not negotiate native frame delivery",
              error
            )
        }
      }
    }
    const currentWindow = getCurrentWebviewWindow()
    const subscriptions = [
      currentWindow.listen<BroadcastPayload>(
        "broadcast:verse-update",
        (event) => {
          if (disposed) return
          latest = {
            ...event.payload,
            theme: normalizeTheme(event.payload.theme),
          }
          preloadThemeImages(latest.theme, () => draw())
          draw()
        }
      ),
      currentWindow.listen<NdiConfigEventPayload>(
        "broadcast:ndi-config",
        (event) => {
          if (disposed) return
          if (event.payload.active) void connect()
          else {
            negotiation++
            config = null
            delivery.stop()
          }
        }
      ),
    ]
    void Promise.all(subscriptions)
      .then(() => {
        if (disposed) return
        return currentWindow.emitTo("main", "broadcast:output-ready", {
          outputId: OUTPUT_ID,
        })
      })
      .catch((error: unknown) =>
        console.warn("[broadcast-output] listener setup failed", error)
      )
    const unsubscribeFonts = onThemeFontsLoaded(draw)
    draw()
    void connect()
    return () => {
      disposed = true
      negotiation++
      config = null
      delivery.stop()
      unsubscribeFonts()
      subscriptions.forEach((subscription) => {
        void subscription.then((stop) => stop()).catch(() => {})
      })
    }
  }, [])
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
