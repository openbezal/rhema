import type {
  BroadcastTheme,
  ElementBox,
  VerseRenderData,
} from "@/types/broadcast"
import {
  computeVerseLayoutMetrics,
  type VerseLayoutMetrics,
} from "./verse-renderer"

/** Sample verse used wherever a layout must be computed without live data. */
export const SAMPLE_VERSE: VerseRenderData = {
  reference: "Genesis 1:1 (KJV)",
  segments: [
    {
      verseNumber: 1,
      text: "In the beginning God created the heaven and the earth.",
    },
  ],
}

const DEFAULT_VERSE_NUMBERS: BroadcastTheme["verseNumbers"] = {
  visible: true,
  fontSize: 18,
  color: "#ffffff",
  superscript: true,
}

function isValidBox(box: ElementBox | undefined): box is ElementBox {
  return (
    box !== undefined &&
    [box.x, box.y, box.width, box.height].every(
      (v) => typeof v === "number" && Number.isFinite(v)
    ) &&
    box.width > 0 &&
    box.height > 0
  )
}

/**
 * Fill defaults on themes loaded from disk, import, or IPC so older saved
 * themes (created before free positioning / verse-number styling existed)
 * keep working unchanged.
 */
export function normalizeTheme(theme: BroadcastTheme): BroadcastTheme {
  const layout = { ...theme.layout }
  layout.mode = layout.mode === "free" ? "free" : "stacked"
  if (
    layout.mode === "free" &&
    (!isValidBox(layout.referenceBox) || !isValidBox(layout.verseBox))
  ) {
    layout.mode = "stacked"
  }
  return {
    ...theme,
    verseNumbers: { ...DEFAULT_VERSE_NUMBERS, ...theme.verseNumbers },
    layout,
  }
}

// Floor the origin and ceil the size (at 2 decimals) so the percent box is
// guaranteed to contain the source rect — a width rounded down would reduce
// the wrap width and re-flow the text on detach.
const rectToBox = (
  rect: { x: number; y: number; width: number; height: number },
  canvasW: number,
  canvasH: number
): ElementBox => ({
  x: Math.floor((rect.x / canvasW) * 10000) / 100,
  y: Math.floor((rect.y / canvasH) * 10000) / 100,
  width: Math.ceil((rect.width / canvasW) * 10000) / 100,
  height: Math.ceil((rect.height / canvasH) * 10000) / 100,
})

/**
 * Compute seed boxes for a theme directly (used by the properties panel's
 * "free positioning" toggle, where no designer metrics are at hand). Lays the
 * theme out in stacked mode against a sample verse and converts the resulting
 * rects.
 */
export function seedFreeBoxesForTheme(
  theme: BroadcastTheme,
  verse: VerseRenderData = SAMPLE_VERSE
): { referenceBox: ElementBox; verseBox: ElementBox } | null {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return null
  const stackedTheme: BroadcastTheme = {
    ...theme,
    layout: { ...theme.layout, mode: "stacked" },
  }
  const metrics = computeVerseLayoutMetrics(ctx, stackedTheme, verse)
  return seedFreeBoxesFromMetrics(metrics, theme.resolution)
}

/**
 * Seed free-mode element boxes from stacked layout metrics (computed at
 * scale 1). Each box tightly wraps its rendered content, so on detach the
 * frame hugs the text and dragging it moves the text 1:1. Line breaks are
 * preserved: greedy wrap at the widest-line width reproduces the same lines.
 */
export function seedFreeBoxesFromMetrics(
  metrics: VerseLayoutMetrics,
  resolution: BroadcastTheme["resolution"]
): { referenceBox: ElementBox; verseBox: ElementBox } | null {
  const { referenceRect, verseRect } = metrics
  if (!referenceRect || !verseRect) return null
  const { width: canvasW, height: canvasH } = resolution
  return {
    referenceBox: rectToBox(referenceRect, canvasW, canvasH),
    verseBox: rectToBox(verseRect, canvasW, canvasH),
  }
}
