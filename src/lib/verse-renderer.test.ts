import { describe, expect, it, vi } from "vitest"
import type { BroadcastTheme, VerseRenderData } from "@/types/broadcast"

// Deterministic stand-in for pretext: character width is 0.6 × the px size
// parsed from the item font, lines wrap greedily at maxWidth. Enough for the
// layout math under test (wrapping monotonicity, rect containment, auto-fit).
vi.mock("@chenglou/pretext/rich-inline", () => {
  const parsePx = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
  const itemWidth = (item: { text: string; font: string }) =>
    item.text.trim().length * parsePx(item.font) * 0.6

  const lineWidths = (
    prepared: { items: { text: string; font: string }[] },
    maxWidth: number
  ): number[] => {
    const widths: number[] = []
    let current = 0
    for (const item of prepared.items) {
      const w = itemWidth(item)
      if (current > 0 && current + w > maxWidth) {
        widths.push(current)
        current = w
      } else {
        current += w
      }
      while (current > maxWidth) {
        widths.push(maxWidth)
        current -= maxWidth
      }
    }
    if (current > 0) widths.push(current)
    return widths.length ? widths : [0]
  }

  return {
    prepareRichInline: (items: { text: string; font: string }[]) => ({ items }),
    measureRichInlineStats: (
      prepared: { items: { text: string; font: string }[] },
      maxWidth: number
    ) => {
      const widths = lineWidths(prepared, maxWidth)
      return { lineCount: widths.length, maxLineWidth: Math.max(...widths) }
    },
    walkRichInlineLineRanges: (
      prepared: { items: { text: string; font: string }[] },
      maxWidth: number,
      onLine: (line: unknown) => void
    ) => {
      const widths = lineWidths(prepared, maxWidth)
      for (const width of widths) onLine({ fragments: [], width, end: {} })
      return widths.length
    },
    materializeRichInlineLineRange: (
      _prepared: unknown,
      line: { width: number }
    ) => ({ fragments: [], width: line.width, end: {} }),
  }
})

import { computeVerseLayoutMetrics } from "./verse-renderer"
import { BUILTIN_THEMES } from "./builtin-themes"

function stubCtx(): CanvasRenderingContext2D {
  let font = "16px test"
  return {
    get font() {
      return font
    },
    set font(value: string) {
      font = value
    },
    measureText: (text: string) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16)
      return { width: text.length * size * 0.6 } as TextMetrics
    },
    save: () => {},
    restore: () => {},
  } as unknown as CanvasRenderingContext2D
}

const VERSE: VerseRenderData = {
  reference: "Genesis 1:1 (KJV)",
  segments: [
    {
      verseNumber: 1,
      text: "In the beginning God created the heaven and the earth.",
    },
  ],
}

const within = (
  inner: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number }
) =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.width <= outer.x + outer.width + 0.01 &&
  inner.y + inner.height <= outer.y + outer.height + 0.01

function freeTheme(
  overrides: Partial<BroadcastTheme["layout"]> = {}
): BroadcastTheme {
  const base = BUILTIN_THEMES[0]
  return {
    ...base,
    layout: {
      ...base.layout,
      mode: "free",
      referenceBox: { x: 5, y: 5, width: 50, height: 10 },
      verseBox: { x: 10, y: 25, width: 60, height: 50 },
      ...overrides,
    },
  }
}

describe("computeVerseLayoutMetrics — free mode", () => {
  it("places the reference rect inside its box", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), freeTheme(), VERSE)
    expect(metrics.referenceBoxRect).toEqual({
      x: 96,
      y: 54,
      width: 960,
      height: 108,
    })
    expect(within(metrics.referenceRect!, metrics.referenceBoxRect!)).toBe(true)
  })

  it("places the verse rect inside its box", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), freeTheme(), VERSE)
    expect(metrics.verseBoxRect).toEqual({
      x: 192,
      y: 270,
      width: 1152,
      height: 540,
    })
    expect(within(metrics.verseRect!, metrics.verseBoxRect!)).toBe(true)
  })

  it("uses the verse box as the text box backdrop area", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), freeTheme(), VERSE)
    expect(metrics.textAreaRect).toEqual(metrics.verseBoxRect)
  })

  it("auto-fits to a smaller font size when the verse box shrinks", () => {
    const roomy = computeVerseLayoutMetrics(stubCtx(), freeTheme(), VERSE)
    const cramped = computeVerseLayoutMetrics(
      stubCtx(),
      freeTheme({ verseBox: { x: 10, y: 25, width: 20, height: 12 } }),
      VERSE
    )
    expect(roomy.fittedVerseFontSize).toBeDefined()
    expect(cramped.fittedVerseFontSize!).toBeLessThan(
      roomy.fittedVerseFontSize!
    )
  })

  it("falls back to stacked layout when boxes are missing", () => {
    const theme = freeTheme({ referenceBox: undefined, verseBox: undefined })
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(metrics.referenceBoxRect).toBeNull()
    expect(metrics.verseBoxRect).toBeNull()
    expect(metrics.referenceRect).not.toBeNull()
    expect(metrics.verseRect).not.toBeNull()
  })
})

describe("computeVerseLayoutMetrics — stacked mode", () => {
  it("keeps the reference above the verse for position 'above'", () => {
    const theme = BUILTIN_THEMES[0] // Classic Dark, position "above"
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(metrics.referenceRect!.y).toBeLessThan(metrics.verseRect!.y)
  })

  it("keeps the reference below the verse for position 'below'", () => {
    const theme = BUILTIN_THEMES[2] // Broadcast Overlay, position "below"
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(metrics.referenceRect!.y).toBeGreaterThan(metrics.verseRect!.y)
  })

  it("reports the fitted verse font size", () => {
    const metrics = computeVerseLayoutMetrics(
      stubCtx(),
      BUILTIN_THEMES[0],
      VERSE
    )
    expect(metrics.fittedVerseFontSize).toBeGreaterThan(0)
    expect(metrics.fittedVerseFontSize).toBeLessThanOrEqual(
      BUILTIN_THEMES[0].verseText.fontSize
    )
  })

  it("returns no element rects without a verse", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), BUILTIN_THEMES[0], null)
    expect(metrics.referenceRect).toBeNull()
    expect(metrics.verseRect).toBeNull()
    expect(metrics.fittedVerseFontSize).toBeUndefined()
  })
})
