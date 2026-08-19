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

import { computeVerseLayoutMetrics, renderVerse } from "./verse-renderer"
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

  it("uses the verse box as the verse draw area", () => {
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
    const base = BUILTIN_THEMES[2]
    const theme: BroadcastTheme = {
      ...base,
      reference: { ...base.reference, position: "below" },
    }
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(metrics.referenceRect!.y).toBeGreaterThan(metrics.verseRect!.y)
  })

  it("puts the Lower Thirds reference above the verse, both flush left", () => {
    const lowerThirds = BUILTIN_THEMES[2]
    expect(lowerThirds.name).toBe("Lower Thirds")
    const metrics = computeVerseLayoutMetrics(stubCtx(), lowerThirds, VERSE)
    expect(metrics.referenceRect!.y).toBeLessThan(metrics.verseRect!.y)
    // Both share one left edge, inset from the band by the layout padding
    // plus the container surface's own padding.
    expect(metrics.referenceRect!.x).toBe(metrics.verseRect!.x)
    expect(metrics.referenceRect!.x).toBe(
      metrics.textAreaRect.x +
        lowerThirds.layout.padding.left +
        lowerThirds.textBox.padding
    )
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

/**
 * Recording canvas context: no-ops every method, records each call, and
 * keeps `font` + `measureText` behaving like stubCtx so layout math runs.
 */
function recordingCtx(): {
  ctx: CanvasRenderingContext2D
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  const props: Record<string | symbol, unknown> = { font: "16px test" }
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "measureText") {
          return (text: string) => {
            const size = Number(
              /(\d+(?:\.\d+)?)px/.exec(String(props.font))?.[1] ?? 16
            )
            return { width: text.length * size * 0.6 } as TextMetrics
          }
        }
        if (prop in props) return props[prop]
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args })
        }
      },
      set(_target, prop, value) {
        props[prop] = value
        return true
      },
    }
  ) as CanvasRenderingContext2D
  return { ctx, calls }
}

function overlayFreeTheme(): BroadcastTheme {
  const base = BUILTIN_THEMES[2] // Lower Thirds
  return {
    ...base,
    layout: {
      ...base.layout,
      mode: "free",
      referenceBox: { x: 5, y: 5, width: 50, height: 10 },
      verseBox: { x: 10, y: 25, width: 60, height: 50 },
    },
  }
}

describe("computeVerseLayoutMetrics — text box backdrop", () => {
  // Lower Thirds: textArea 90% × 40%, anchored bottom-center →
  // {x: 96, y: 648, width: 1728, height: 432}.
  const ANCHORED_BAND = { x: 96, y: 648, width: 1728, height: 432 }

  it("equals the anchored text area in stacked mode", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), BUILTIN_THEMES[2], VERSE)
    expect(metrics.textBoxRect).toEqual(metrics.textAreaRect)
    expect(metrics.textBoxRect).toEqual(ANCHORED_BAND)
  })

  it("stays at the anchored text area in free mode", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), overlayFreeTheme(), VERSE)
    expect(metrics.textBoxRect).toEqual(ANCHORED_BAND)
  })

  it("does not move when the free-mode boxes are dragged", () => {
    const before = computeVerseLayoutMetrics(stubCtx(), overlayFreeTheme(), VERSE)
    const theme = overlayFreeTheme()
    theme.layout.referenceBox = { x: 30, y: 40, width: 50, height: 10 }
    theme.layout.verseBox = { x: 35, y: 55, width: 60, height: 30 }
    const after = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(after.textBoxRect).toEqual(before.textBoxRect)
  })

  it("is present without a verse", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), overlayFreeTheme(), null)
    expect(metrics.textBoxRect).toEqual(ANCHORED_BAND)
  })

  it("draws the backdrop at the anchored band, not the verse box", () => {
    const { ctx, calls } = recordingCtx()
    renderVerse(ctx, overlayFreeTheme(), VERSE)
    // roundRect starts with moveTo(x + radius, y); Lower Thirds radius = 12.
    const moveTos = calls.filter((c) => c.method === "moveTo")
    expect(moveTos.some((c) => c.args[0] === 96 + 12 && c.args[1] === 648)).toBe(
      true
    )
  })
})

describe("surface fills", () => {
  const BAND_IMAGE = "data:image/png;base64,band"

  function stubImage(): HTMLImageElement {
    return { naturalWidth: 1920, naturalHeight: 300 } as HTMLImageElement
  }

  function themeWithContainerImage(): BroadcastTheme {
    const base = BUILTIN_THEMES[2] // Lower Thirds
    return {
      ...base,
      textBox: {
        ...base.textBox,
        image: {
          url: BAND_IMAGE,
          fit: "cover",
          blur: 0,
          brightness: 100,
          tint: null,
        },
      },
    }
  }

  it("draws a container image into the container rect, not the background rect", () => {
    const { ctx, calls } = recordingCtx()
    const theme = themeWithContainerImage()
    renderVerse(ctx, theme, VERSE, {
      imageCache: new Map([[BAND_IMAGE, stubImage()]]),
    })

    const draws = calls.filter((c) => c.method === "drawImage")
    expect(draws).toHaveLength(1)
    // "cover" on a 1920x300 image in the 1728x432 band: scaled to the band's
    // height and centred horizontally, so it starts left of the band's x.
    const [, , , width, height] = draws[0].args as number[]
    expect(height).toBe(432)
    expect(width).toBeCloseTo(432 * (1920 / 300), 5)
  })

  it("clips the container image to the surface, not the whole frame", () => {
    const { ctx, calls } = recordingCtx()
    renderVerse(ctx, themeWithContainerImage(), VERSE, {
      imageCache: new Map([[BAND_IMAGE, stubImage()]]),
    })
    expect(calls.some((c) => c.method === "clip")).toBe(true)
    // The rounded clip path starts at the band's own corner radius.
    const moveTos = calls.filter((c) => c.method === "moveTo")
    expect(moveTos.some((c) => c.args[0] === 96 + 12 && c.args[1] === 648)).toBe(
      true
    )
  })

  it("insets the text by the container's padding", () => {
    const base = BUILTIN_THEMES[2]
    const padded = computeVerseLayoutMetrics(stubCtx(), base, VERSE)
    const unpadded = computeVerseLayoutMetrics(
      stubCtx(),
      { ...base, textBox: { ...base.textBox, padding: 0 } },
      VERSE
    )
    expect(padded.textRect.x - unpadded.textRect.x).toBe(base.textBox.padding)
    expect(padded.textRect.width).toBe(
      unpadded.textRect.width - base.textBox.padding * 2
    )
  })

  it("ignores container padding when the container is disabled", () => {
    const base = BUILTIN_THEMES[2]
    const off = computeVerseLayoutMetrics(
      stubCtx(),
      { ...base, textBox: { ...base.textBox, enabled: false } },
      VERSE
    )
    const zeroPad = computeVerseLayoutMetrics(
      stubCtx(),
      { ...base, textBox: { ...base.textBox, enabled: false, padding: 0 } },
      VERSE
    )
    expect(off.textRect).toEqual(zeroPad.textRect)
  })

  it("leaves per-element surfaces off when the theme does not define them", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), BUILTIN_THEMES[2], VERSE)
    expect(metrics.referenceSurfaceRect).toBeNull()
    expect(metrics.verseSurfaceRect).toBeNull()
  })

  it("hugs the reference text when the reference has its own plate", () => {
    const base = BUILTIN_THEMES[2]
    const theme: BroadcastTheme = {
      ...base,
      reference: {
        ...base.reference,
        surface: {
          enabled: true,
          color: "#000000",
          opacity: 1,
          borderRadius: 4,
          padding: 10,
          image: null,
        },
      },
    }
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    const chip = metrics.referenceSurfaceRect!
    const text = metrics.referenceRect!
    expect(chip.x).toBe(text.x - 10)
    expect(chip.width).toBe(text.width + 20)
    // A chip hugs its text, so it must be narrower than the whole band.
    expect(chip.width).toBeLessThan(metrics.textBoxRect.width)
  })

  it("scales surface radius, padding and image blur with the render scale", () => {
    const base = themeWithContainerImage()
    const theme: BroadcastTheme = {
      ...base,
      textBox: { ...base.textBox, image: { ...base.textBox.image!, blur: 8 } },
    }
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE, {
      scale: 0.5,
    })
    expect(metrics.scaledTheme.textBox.borderRadius).toBe(
      theme.textBox.borderRadius * 0.5
    )
    expect(metrics.scaledTheme.textBox.padding).toBe(theme.textBox.padding * 0.5)
    expect(metrics.scaledTheme.textBox.image!.blur).toBe(4)
  })
})

describe("computeVerseLayoutMetrics — background region", () => {
  it("covers the full canvas at 100% × 100%", () => {
    const metrics = computeVerseLayoutMetrics(stubCtx(), BUILTIN_THEMES[0], VERSE)
    expect(metrics.backgroundRect).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it("bounds the background to its dimensions at the anchor", () => {
    const base = BUILTIN_THEMES[2] // bottom-center
    const theme: BroadcastTheme = {
      ...base,
      layout: { ...base.layout, backgroundWidth: 100, backgroundHeight: 30 },
    }
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(metrics.backgroundRect).toEqual({
      x: 0,
      y: 756,
      width: 1920,
      height: 324,
    })
  })

  it("keeps the text area inside the bounded background", () => {
    const base = BUILTIN_THEMES[2]
    const theme: BroadcastTheme = {
      ...base,
      layout: { ...base.layout, backgroundWidth: 80, backgroundHeight: 30 },
    }
    const metrics = computeVerseLayoutMetrics(stubCtx(), theme, VERSE)
    expect(within(metrics.textAreaRect, metrics.backgroundRect)).toBe(true)
  })

  it("fills a solid background only within the background rect", () => {
    const base = BUILTIN_THEMES[1] // Modern Light, solid background
    const theme: BroadcastTheme = {
      ...base,
      layout: {
        ...base.layout,
        anchor: "bottom-center",
        backgroundWidth: 100,
        backgroundHeight: 30,
      },
    }
    const { ctx, calls } = recordingCtx()
    renderVerse(ctx, theme, VERSE)
    const fills = calls.filter((c) => c.method === "fillRect")
    expect(fills).toContainEqual({
      method: "fillRect",
      args: [0, 756, 1920, 324],
    })
    expect(
      fills.some((c) => c.args[2] === 1920 && c.args[3] === 1080)
    ).toBe(false)
  })
})
