import type { BroadcastTheme } from "@/types"
/** Missing overrides inherit current primary styling, including its plate. */
export function secondaryVerseStyle(
  theme: BroadcastTheme
): BroadcastTheme["verseText"] {
  const overrides = Object.fromEntries(
    Object.entries(theme.secondaryVerseText ?? {}).filter(
      ([, value]) => value !== undefined
    )
  )
  return { ...theme.verseText, ...overrides }
}
export function secondaryRenderData(verse: import("@/types").VerseRenderData) {
  return {
    reference: verse.reference,
    segments: verse.secondary?.segments ?? [],
  }
}
