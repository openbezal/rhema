import type { BroadcastTheme } from "@/types"
import type { VerseLayoutMetrics, VerseLayoutRect } from "./verse-renderer"
const nonnegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0
/** The languages own regions even in stacked mode, so vertical alignment and
 * plate padding have a stable meaning independent of the amount of text. */
export function bilingualRegions(
  theme: BroadcastTheme,
  base: VerseLayoutMetrics
) {
  const split = (rect: VerseLayoutRect, gap: number) => {
    const share = Number.isFinite(theme.layout.primaryShare)
      ? Math.max(10, Math.min(90, theme.layout.primaryShare!)) / 100
      : 0.5
    const height = Math.max(0, rect.height - gap),
      primaryHeight = height * share
    return {
      primary: { ...rect, height: primaryHeight },
      secondary: {
        ...rect,
        y: rect.y + primaryHeight + gap,
        height: height - primaryHeight,
      },
    }
  }
  const gap = nonnegative(theme.layout.languageGap ?? 24)
  if (base.verseBoxRect && base.referenceBoxRect) {
    if (theme.layout.secondaryBox) {
      const box = theme.layout.secondaryBox,
        { width, height } = theme.resolution
      return {
        primary: base.verseBoxRect,
        secondary: {
          x: (box.x * width) / 100,
          y: (box.y * height) / 100,
          width: Math.max(0, (box.width * width) / 100),
          height: Math.max(0, (box.height * height) / 100),
        },
        reference: base.referenceBoxRect,
      }
    }
    return {
      ...split(base.verseBoxRect, Math.min(gap, base.verseBoxRect.height)),
      reference: base.referenceBoxRect,
    }
  }
  const rect = base.textRect,
    referencePadding = theme.reference.surface?.enabled
      ? nonnegative(theme.reference.surface.padding)
      : 0
  const referenceHeight = Math.min(
    Math.max(0, rect.height),
    theme.reference.fontSize * 1.5 + 2 * referencePadding
  )
  const referenceGap = nonnegative(
    theme.layout.referenceGap ?? theme.reference.fontSize * 0.5
  )
  const between = theme.reference.position === "inline"
  const space = Math.max(0, rect.height - referenceHeight)
  const effectiveGap = Math.min(gap, space),
    effectiveReferenceGap = between
      ? 0
      : Math.min(referenceGap, space - effectiveGap)
  const content = {
    ...rect,
    height: Math.max(0, space - effectiveReferenceGap),
    y:
      rect.y +
      (theme.reference.position === "above"
        ? referenceHeight + effectiveReferenceGap
        : 0),
  }
  const regions = split(content, effectiveGap)
  let referenceY = rect.y
  if (theme.reference.position === "below")
    referenceY = rect.y + rect.height - referenceHeight
  if (between) {
    referenceY = regions.primary.y + regions.primary.height + effectiveGap / 2
    regions.secondary.y += referenceHeight
  }
  return {
    ...regions,
    reference: { ...rect, y: referenceY, height: referenceHeight },
  }
}
