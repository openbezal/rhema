export interface VerseSegment {
  verseNumber?: number
  text: string
}

export interface VerseRenderData {
  reference: string
  segments: VerseSegment[]
}

export interface RenderOptions {
  opacity?: number
  offsetX?: number
  offsetY?: number
  scale?: number               // Scale factor for rendering at display size (e.g., 0.42 for 400px panel)
  imageCache?: Map<string, HTMLImageElement>
}

/** A freely positioned element region, all values in % of canvas size (0-100), x/y = top-left. */
export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

/** An image fill: how a picture is fitted into whatever rect it is drawn in. */
export interface ThemeImageFill {
  url: string
  fit: "cover" | "contain" | "stretch"
  blur: number
  brightness: number
  tint: string | null
}

/**
 * A filled surface drawn behind content — the container the text lives in.
 * Content wraps inside it, inset by `padding`.
 */
export interface SurfaceFill {
  enabled: boolean
  color: string
  opacity: number
  borderRadius: number
  /** Inset for the content on this surface, in theme px. */
  padding: number
  /** When set, fills the surface, clipped to `borderRadius`. */
  image: ThemeImageFill | null
}

export type TextHorizontalAlign = "left" | "center" | "right" | "justify"
export type TextVerticalAlign = "top" | "middle" | "bottom"
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize"
export type TextDecoration = "none" | "underline" | "line-through"

export interface BroadcastTheme {
  id: string
  name: string
  builtin: boolean
  pinned: boolean
  createdAt: number
  updatedAt: number
  resolution: { width: number; height: number }
  background: {
    type: "solid" | "gradient" | "image" | "transparent"
    color: string
    gradient: {
      type: "linear" | "radial"
      angle: number
      stops: { color: string; position: number }[]
    } | null
    image: ThemeImageFill | null
  }
  /**
   * The container holding the reference + verse block. Its fill can be a
   * colour or an image, and the text wraps inside it.
   */
  textBox: SurfaceFill
  verseText: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    horizontalAlign?: TextHorizontalAlign
    verticalAlign?: TextVerticalAlign
    textTransform?: TextTransform
    textDecoration?: TextDecoration
    lineHeight: number
    letterSpacing: number
    shadow: { color: string; blur: number; x: number; y: number } | null
    outline: { color: string; width: number } | null
    /** Optional plate behind the verse text alone. Absent means none. */
    surface?: SurfaceFill
  }
  verseNumbers: {
    visible: boolean
    fontSize: number
    color: string
    superscript: boolean
  }
  reference: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    horizontalAlign?: TextHorizontalAlign
    verticalAlign?: TextVerticalAlign
    textTransform?: TextTransform
    textDecoration?: TextDecoration
    uppercase: boolean
    letterSpacing: number
    position: "above" | "below" | "inline"
    /** Optional chip behind the reference alone. Absent means none. */
    surface?: SurfaceFill
  }
  layout: {
    anchor:
      | "center"
      | "top-left"
      | "top-center"
      | "top-right"
      | "bottom-left"
      | "bottom-center"
      | "bottom-right"
    offsetX: number
    offsetY: number
    padding: { top: number; right: number; bottom: number; left: number }
    textAlign: "left" | "center" | "right"
    backgroundWidth: number
    backgroundHeight: number
    textAreaWidth: number
    textAreaHeight: number
    referenceGap?: number
    /** "stacked" (default): reference + verse flow as one block. "free": each is positioned by its box. */
    mode?: "stacked" | "free"
    referenceBox?: ElementBox
    verseBox?: ElementBox
  }
  transition: {
    type: "fade" | "slide" | "scale" | "none"
    duration: number
    easing: "linear" | "ease-in" | "ease-out" | "ease-in-out"
    direction: "up" | "down" | "left" | "right"
  }
}
