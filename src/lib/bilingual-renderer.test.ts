import { describe, expect, it, vi } from "vitest"
import type { BroadcastTheme, VerseRenderData } from "@/types"
vi.mock("@chenglou/pretext/rich-inline", () => {
  type Item = { text: string; font: string }
  function layout(items: Item[], width: number) {
    const lines: {
      fragments: {
        text: string
        itemIndex: number
        gapBefore: number
        occupiedWidth: number
      }[]
      width: number
    }[] = []
    let line = {
      fragments: [] as {
        text: string
        itemIndex: number
        gapBefore: number
        occupiedWidth: number
      }[],
      width: 0,
    }
    items.forEach((item, itemIndex) => {
      const px = Number(/([\d.]+)px/.exec(item.font)?.[1] ?? 16)
      for (const text of item.text.match(/\S+\s*/gu) ?? []) {
        const occupiedWidth = text.length * px * 0.5
        if (line.fragments.length && line.width + occupiedWidth > width) {
          lines.push(line)
          line = { fragments: [], width: 0 }
        }
        line.fragments.push({ text, itemIndex, gapBefore: 0, occupiedWidth })
        line.width += occupiedWidth
      }
    })
    if (line.fragments.length) lines.push(line)
    return lines
  }
  return {
    prepareRichInline: (items: Item[]) => ({ items }),
    measureRichInlineStats: (prepared: { items: Item[] }, width: number) => {
      const lines = layout(prepared.items, width)
      return {
        lineCount: lines.length,
        maxLineWidth: Math.max(1, ...lines.map((line) => line.width)),
      }
    },
    walkRichInlineLineRanges: (
      prepared: { items: Item[] },
      width: number,
      callback: (line: unknown) => void
    ) => {
      const lines = layout(prepared.items, width)
      lines.forEach(callback)
      return lines.length
    },
    materializeRichInlineLineRange: (_prepared: unknown, line: unknown) => line,
  }
})
import {
  computeVerseLayoutMetrics,
  renderVerse,
  prepareVerseInline,
} from "./verse-renderer"
import { BUILTIN_THEMES } from "./builtin-themes"
function recorder() {
  const text: {
      text: string
      x: number
      y: number
      font: string
      color: string
    }[] = [],
    fills: string[] = [],
    clips: number[] = []
  const state: Record<string, unknown> = {
    font: "16px serif",
    fillStyle: "#000",
    globalAlpha: 1,
  }
  const stack: Record<string, unknown>[] = []
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === "save") return () => stack.push({ ...target })
      if (key === "restore") return () => Object.assign(target, stack.pop())
      if (key === "fillText")
        return (value: string, x: number, y: number) =>
          text.push({
            text: value,
            x,
            y,
            font: String(target.font),
            color: String(target.fillStyle),
          })
      if (key === "measureText")
        return (value: string) => ({
          width:
            value.length *
            Number(/([\d.]+)px/.exec(String(target.font))?.[1] ?? 16) *
            0.5,
        })
      if (key === "fill" || key === "fillRect")
        return () => fills.push(String(target.fillStyle))
      if (key === "clip") return () => clips.push(1)
      return key in target ? target[key] : () => {}
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, text, fills, clips }
}
const dual: VerseRenderData = {
  reference: "John 3:16 (ESV · KJV)",
  segments: [{ text: "PRIMARY short text" }],
  secondary: {
    translationCode: "KJV",
    segments: [{ text: "SECONDARY short text" }],
  },
}
function theme(): BroadcastTheme {
  const base = BUILTIN_THEMES[0]
  return {
    ...base,
    resolution: { width: 640, height: 360 },
    background: { ...base.background, type: "solid" },
    verseText: {
      ...base.verseText,
      fontSize: 24,
      lineHeight: 1.2,
      shadow: null,
      outline: null,
      surface: undefined,
      verticalAlign: "top",
      color: "#112233",
    },
    secondaryVerseText: { color: "#445566" },
    reference: {
      ...base.reference,
      fontSize: 16,
      position: "above",
      surface: undefined,
    },
    textBox: { ...base.textBox, enabled: false },
    layout: {
      ...base.layout,
      mode: "stacked",
      padding: { top: 4, right: 4, bottom: 4, left: 4 },
      textAreaHeight: 90,
      textAreaWidth: 95,
    },
  }
}
const plate = {
  enabled: true,
  color: "#f01487",
  opacity: 1,
  borderRadius: 0,
  padding: 24,
  image: null,
}
describe("independent reference and body verse numbers", () => {
  for (const bilingual of [false, true]) {
    for (const position of ["above", "below", "inline", "free"] as const) {
      it(`measures and draws the chapter reference in ${position}, bilingual=${bilingual}`, () => {
        const data: VerseRenderData = {
          ...dual,
          address: {
            bookNumber: 43,
            bookName: "John",
            chapter: 3,
            verse: 16,
            translationCode: "ESV",
            ...(bilingual ? { secondaryTranslationCode: "KJV" } : {}),
          },
          segments: [{ verseNumber: 16, text: "PRIMARY short text" }],
          secondary: bilingual
            ? {
                translationCode: "KJV",
                segments: [{ verseNumber: 16, text: "SECONDARY short text" }],
              }
            : undefined,
        }
        const t = theme()
        t.reference = {
          ...t.reference,
          uppercase: false,
          textTransform: "none",
          includeVerseNumbers: false,
          position: position === "free" ? "above" : position,
        }
        t.verseNumbers = { ...t.verseNumbers, visible: true }
        if (position === "free")
          t.layout = {
            ...t.layout,
            mode: "free",
            referenceBox: { x: 5, y: 5, width: 90, height: 12 },
            verseBox: { x: 5, y: 25, width: 90, height: 25 },
            secondaryBox: { x: 5, y: 60, width: 90, height: 25 },
          }
        const short = recorder()
        const shortMetrics = renderVerse(short.ctx, t, data)!
        expect(shortMetrics).not.toBeNull()
        expect(short.text.map((row) => row.text)).toContain(
          `John 3 (ESV${bilingual ? " · KJV" : ""})`
        )
        expect(
          short.text.filter((row) => row.text.trim() === "16")
        ).toHaveLength(bilingual ? 2 : 1)
        t.reference.includeVerseNumbers = true
        const full = recorder()
        const fullMetrics = renderVerse(full.ctx, t, data)!
        expect(full.text.map((row) => row.text)).toContain(
          `John 3:16 (ESV${bilingual ? " · KJV" : ""})`
        )
        expect(shortMetrics.referenceRect!.width).toBeLessThan(
          fullMetrics.referenceRect!.width
        )
        t.verseNumbers.visible = false
        const noBodyNumbers = recorder()
        renderVerse(noBodyNumbers.ctx, t, data)
        expect(
          noBodyNumbers.text.filter((row) => row.text.trim() === "16")
        ).toHaveLength(0)
        expect(noBodyNumbers.text.map((row) => row.text)).toContain(
          `John 3:16 (ESV${bilingual ? " · KJV" : ""})`
        )
        data.address!.displayBookName = "Yohanan"
        const renamed = recorder()
        const renamedMetrics = renderVerse(renamed.ctx, t, data)!
        expect(renamed.text.map((row) => row.text)).toContain(
          `Yohanan 3:16 (ESV${bilingual ? " · KJV" : ""})`
        )
        expect(renamedMetrics.referenceRect!.width).toBeGreaterThan(
          fullMetrics.referenceRect!.width
        )
      })
    }
  }
})
describe("bilingual output pixels and geometry", () => {
  it("draws actual primary and secondary fragments with independent styles", () => {
    const r = recorder()
    expect(renderVerse(r.ctx, theme(), dual)).not.toBeNull()
    expect(r.text.find((row) => row.text.startsWith("PRIMARY"))?.color).toBe(
      "#112233"
    )
    expect(r.text.find((row) => row.text.startsWith("SECONDARY"))?.color).toBe(
      "#445566"
    )
  })
  it("draws a secondary-only plate and gives it a content region", () => {
    const r = recorder(),
      t = theme()
    t.secondaryVerseText = { surface: plate }
    const metrics = renderVerse(r.ctx, t, dual)!
    expect(r.fills).toContain(plate.color)
    expect(metrics.secondarySurfaceRect).toBeDefined()
    expect(metrics.secondaryContentRect!.width).toBeLessThan(
      metrics.secondarySurfaceRect!.width
    )
  })
  it("uses secondary plate padding for wrapping and auto-fit", () => {
    const t = theme(),
      content = {
        ...dual,
        secondary: {
          ...dual.secondary!,
          segments: [{ text: "SECONDARY long words ".repeat(18) }],
        },
      }
    t.secondaryVerseText = { fontSize: 40, surface: { ...plate, padding: 0 } }
    const without = computeVerseLayoutMetrics(recorder().ctx, t, content)
    t.secondaryVerseText.surface = { ...plate, padding: 36 }
    const padded = computeVerseLayoutMetrics(recorder().ctx, t, content)
    expect(padded.secondaryContentRect!.width).toBeLessThan(
      without.secondaryContentRect!.width
    )
    expect(padded.fittedSecondaryVerseFontSize!).toBeLessThanOrEqual(
      without.fittedSecondaryVerseFontSize!
    )
  })
  it("aligns secondary inside its own region without moving primary", () => {
    const t = theme(),
      positions = ["top", "middle", "bottom"].map((verticalAlign) => {
        t.secondaryVerseText = {
          verticalAlign: verticalAlign as "top" | "middle" | "bottom",
        }
        const r = recorder()
        renderVerse(r.ctx, t, dual)
        return {
          primary: r.text.find((row) => row.text.startsWith("PRIMARY"))!,
          secondary: r.text.find((row) => row.text.startsWith("SECONDARY"))!,
        }
      })
    expect(positions.map((row) => row.primary.y)).toEqual([
      positions[0].primary.y,
      positions[0].primary.y,
      positions[0].primary.y,
    ])
    expect(positions[0].secondary.y).toBeLessThan(positions[1].secondary.y)
    expect(positions[1].secondary.y).toBeLessThan(positions[2].secondary.y)
  })
  it("inherits primary typography while preserving optional overrides", () => {
    const t = theme()
    t.verseText.fontFamily = "Source Serif 4"
    t.secondaryVerseText = { color: "#445566" }
    const r = recorder()
    renderVerse(r.ctx, t, dual)
    expect(
      r.text.find((row) => row.text.startsWith("SECONDARY"))?.font
    ).toContain("Source Serif 4")
  })
  it("scales both language regions, font sizes and plate padding for previews", () => {
    const t = theme()
    t.secondaryVerseText = { fontSize: 20, surface: plate }
    const full = computeVerseLayoutMetrics(recorder().ctx, t, dual),
      half = computeVerseLayoutMetrics(recorder().ctx, t, dual, { scale: 0.5 })
    expect(half.secondaryContentRect!.width).toBeCloseTo(
      full.secondaryContentRect!.width / 2
    )
    expect(half.fittedSecondaryVerseFontSize).toBeCloseTo(
      full.fittedSecondaryVerseFontSize! / 2
    )
  })
  it("uses an independent secondary box in free positioning", () => {
    const t = theme()
    t.layout = {
      ...t.layout,
      mode: "free",
      referenceBox: { x: 5, y: 2, width: 80, height: 10 },
      verseBox: { x: 5, y: 20, width: 40, height: 40 },
      secondaryBox: { x: 55, y: 50, width: 40, height: 40 },
    }
    const metrics = computeVerseLayoutMetrics(recorder().ctx, t, dual)
    expect(metrics.secondaryBoxRect).toEqual({
      x: 352,
      y: 180,
      width: 256,
      height: 144,
    })
    expect(metrics.verseRect!.x).toBeLessThan(metrics.secondaryVerseRect!.x)
  })
  it.each(["above", "below", "inline"] as const)(
    "keeps reference placement %s distinct from both languages",
    (position) => {
      const t = theme()
      t.reference.position = position
      const metrics = computeVerseLayoutMetrics(recorder().ctx, t, dual)
      expect(metrics.secondaryVerseRect).toBeDefined()
      if (position === "above")
        expect(
          metrics.referenceRect!.y + metrics.referenceRect!.height
        ).toBeLessThanOrEqual(metrics.verseRect!.y)
      if (position === "below")
        expect(metrics.referenceRect!.y).toBeGreaterThanOrEqual(
          metrics.secondaryVerseRect!.y + metrics.secondaryVerseRect!.height
        )
      if (position === "inline") {
        expect(metrics.referenceRect!.y).toBeGreaterThanOrEqual(
          metrics.verseRect!.y + metrics.verseRect!.height
        )
        expect(
          metrics.referenceRect!.y + metrics.referenceRect!.height
        ).toBeLessThanOrEqual(metrics.secondaryVerseRect!.y)
      }
    }
  )
  it("clips text that cannot fit at the minimum size and reports the limitation", () => {
    const t = theme()
    t.layout.textAreaHeight = 8
    const r = recorder(),
      metrics = renderVerse(r.ctx, t, {
        ...dual,
        secondary: {
          ...dual.secondary!,
          segments: [{ text: "SECONDARY ".repeat(200) }],
        },
      })!
    expect(metrics.secondaryNoFit).toBe(true)
    expect(r.clips.length).toBeGreaterThan(0)
  })
  it("preserves Yoruba combining-mark fragments through the draw path", () => {
    const r = recorder(),
      text = "Ní ìbẹ̀rẹ̀ ohun gbogbo Ọlọ́run dá àwọn ọ̀run àti ayé."
    renderVerse(r.ctx, theme(), {
      ...dual,
      secondary: { translationCode: "OYCB", segments: [{ text }] },
    })
    expect(r.text.map((row) => row.text).join(" ")).toContain("ìbẹ̀rẹ̀")
    expect(r.text.map((row) => row.text).join(" ")).toContain("Ọlọ́run")
  })
})
it("keeps excessive plate padding inside its owned region and reports no fit", () => {
  const t = theme()
  t.secondaryVerseText = { surface: { ...plate, padding: 10_000 } }
  const metrics = computeVerseLayoutMetrics(recorder().ctx, t, dual),
    content = metrics.secondaryContentRect!,
    region = metrics.secondaryBoxRect!
  expect(content.x + content.width).toBeLessThanOrEqual(region.x + region.width)
  expect(content.y + content.height).toBeLessThanOrEqual(
    region.y + region.height
  )
  expect(metrics.secondaryNoFit).toBe(true)
})
it("clips the shared reference to its own region when its plate leaves no text space", () => {
  const t = theme()
  t.reference.surface = { ...plate, padding: 10_000 }
  const r = recorder()
  renderVerse(r.ctx, t, dual)
  expect(r.clips.length).toBeGreaterThanOrEqual(3)
})
it("reports reference overflow using the reference font rather than the restored context font", () => {
  const t = theme()
  t.reference.fontSize = 64
  const metrics = computeVerseLayoutMetrics(recorder().ctx, t, dual)
  expect(metrics.referenceNoFit).toBe(true)
})
it("renders a deliberate bilingual offline designer sample at workspace scale", async () => {
  const { renderDesignerSample } = await import("./designer-sample")
  const t = theme(),
    r = recorder(),
    metrics = renderDesignerSample(r.ctx, t)!
  expect(r.text.map((row) => row.text).join(" ")).toContain("ìbẹ̀rẹ̀")
  expect(metrics.scaledTheme.resolution).toEqual({ width: 1920, height: 1080 })
  expect(metrics.secondaryVerseRect).toBeDefined()
})
it("secondary designer edits visibly change its sample while primary stays unchanged and live remains off", async () => {
  const { renderDesignerSample } = await import("./designer-sample")
  const { useBroadcastStore } = await import("@/stores/broadcast-store")
  const t = { ...theme(), id: "offline-designer", builtin: false }
  useBroadcastStore.setState({
    themes: [t],
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
  })
  useBroadcastStore.getState().startEditing(t.id)
  const before = recorder()
  renderDesignerSample(before.ctx, useBroadcastStore.getState().draftTheme!)
  useBroadcastStore
    .getState()
    .updateDraftNested("secondaryVerseText.color", "#cc11bb")
  useBroadcastStore
    .getState()
    .updateDraftNested("secondaryVerseText.fontSize", 40)
  const after = recorder()
  renderDesignerSample(after.ctx, useBroadcastStore.getState().draftTheme!)
  expect(after.text.find((row) => row.text.startsWith("Ní"))?.color).toBe(
    "#cc11bb"
  )
  expect(after.text.find((row) => row.text.startsWith("Ní"))?.font).not.toBe(
    before.text.find((row) => row.text.startsWith("Ní"))?.font
  )
  expect(after.text.find((row) => row.text.startsWith("In"))).toEqual(
    before.text.find((row) => row.text.startsWith("In"))
  )
  expect(useBroadcastStore.getState()).toMatchObject({
    isLive: false,
    liveVerse: null,
  })
})
it("detaches bilingual designer regions into free boxes without moving either language", async () => {
  const { renderDesignerSample } = await import("./designer-sample")
  const { seedFreeBoxesFromMetrics } = await import("./theme-migrations")
  const t = theme(),
    stacked = renderDesignerSample(recorder().ctx, t)!
  const boxes = seedFreeBoxesFromMetrics(
    stacked,
    stacked.scaledTheme.resolution
  )!
  expect(boxes.secondaryBox).toBeDefined()
  const free = renderDesignerSample(recorder().ctx, {
    ...t,
    layout: { ...t.layout, mode: "free", ...boxes },
  })!
  expect(free.primaryContentRect!.x).toBeCloseTo(
    stacked.primaryContentRect!.x,
    0
  )
  expect(free.primaryContentRect!.y).toBeCloseTo(
    stacked.primaryContentRect!.y,
    0
  )
  expect(free.secondaryContentRect!.x).toBeCloseTo(
    stacked.secondaryContentRect!.x,
    0
  )
  expect(free.secondaryContentRect!.y).toBeCloseTo(
    stacked.secondaryContentRect!.y,
    0
  )
})

it("forwards negative letter spacing into measured rich-inline text", () => {
  const t = theme()
  t.verseText.letterSpacing = -2
  const handle = prepareVerseInline(t, dual, t.verseText.fontSize)!
  expect(
    (handle.prepared as unknown as { items: { letterSpacing?: number }[] })
      .items[0].letterSpacing
  ).toBe(-2)
})
it("requests a secondary-only font and redraws after its delayed load completes", async () => {
  const { onThemeFontsLoaded } = await import("./verse-renderer")
  let finish!: (faces: unknown[]) => void
  const promise = new Promise<unknown[]>((resolve) => {
    finish = resolve
  })
  const load = vi.fn(() => promise),
    changed = vi.fn()
  vi.stubGlobal("document", { fonts: { load } })
  const stop = onThemeFontsLoaded(changed)
  try {
    const t = theme()
    t.secondaryVerseText = { fontFamily: "Secondary font delay fixture" }
    computeVerseLayoutMetrics(recorder().ctx, t, dual)
    expect(load).toHaveBeenCalledWith(
      expect.stringContaining("Secondary font delay fixture")
    )
    expect(changed).not.toHaveBeenCalled()
    finish([{}])
    await promise
    await Promise.resolve()
    expect(changed).toHaveBeenCalled()
  } finally {
    stop()
    vi.unstubAllGlobals()
  }
})
