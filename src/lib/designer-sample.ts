import { renderVerse } from "./verse-renderer"
import { SAMPLE_VERSE } from "./theme-migrations"
import { themeImageCache } from "./theme-image-cache"
import type { BroadcastTheme, VerseRenderData } from "@/types"
import { applyBookDisplayNames, type BookDisplayOverride } from "./book-display-names"
export const DESIGN_WORKSPACE = { width: 1920, height: 1080 }
/** OYCB Genesis 1:1, Open Yorùbá Contemporary Bible, CC BY-SA 4.0.
 * Official source: https://ebible.org/Scriptures/yor_vpl.zip
 * Full attribution is recorded with our Bible-data upgrade (#187). */
export const BILINGUAL_DESIGN_SAMPLE: VerseRenderData = {
  ...SAMPLE_VERSE,
  reference: "Genesis 1:1 (KJV · OYCB)",
  address: { ...SAMPLE_VERSE.address!, secondaryTranslationCode: "OYCB" },
  secondary: {
    translationCode: "OYCB",
    segments: [
      {
        verseNumber: 1,
        text: "Ní ìbẹ̀rẹ̀ ohun gbogbo Ọlọ́run dá àwọn ọ̀run àti ayé.",
      },
    ],
  },
}
/** Bitmap and hit metrics use exactly the same sample and workspace units. */
export function renderDesignerSample(
  ctx: CanvasRenderingContext2D,
  theme: BroadcastTheme,
  names: readonly BookDisplayOverride[] = []
) {
  return renderVerse(ctx, theme, applyBookDisplayNames(BILINGUAL_DESIGN_SAMPLE, names), {
    scale: DESIGN_WORKSPACE.width / theme.resolution.width,
    imageCache: themeImageCache(),
  })
}
