/**
 * One decoded image per URL for the whole window.
 *
 * Theme images are base64 data URIs embedded in the theme, and the same theme
 * is drawn by every preview, thumbnail, the designer and the output window.
 * A cache per component meant each of those decoded its own copy of the same
 * multi-megabyte picture.
 */
const cache = new Map<string, HTMLImageElement>()
const inFlight = new Map<string, Promise<HTMLImageElement | null>>()

/** The map handed to `renderVerse` via `RenderOptions.imageCache`. */
export function themeImageCache(): Map<string, HTMLImageElement> {
  return cache
}

/**
 * Ensure `url` is decoded and cached. Resolves to the image, or null if it
 * failed to load. Concurrent callers share one decode.
 */
export function loadThemeImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  const cached = cache.get(url)
  if (cached) return Promise.resolve(cached)

  const pending = inFlight.get(url)
  if (pending) return pending

  const request = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => {
      cache.set(url, img)
      inFlight.delete(url)
      resolve(img)
    }
    img.onerror = () => {
      inFlight.delete(url)
      console.warn("[theme-image] failed to load image")
      resolve(null)
    }
    img.src = url
  })
  inFlight.set(url, request)
  return request
}

export interface ImageContentBox {
  sx: number
  sy: number
  sw: number
  sh: number
}

const contentBoxes = new WeakMap<HTMLImageElement, ImageContentBox>()

/**
 * The bounds of an image's non-transparent pixels.
 *
 * Artwork is often exported on a full-frame canvas with the graphic in one
 * corner and the rest transparent. Fitting the whole canvas would shrink the
 * visible art into a corner of its container, so fitting uses these bounds
 * instead. Fully opaque images return their natural bounds unchanged.
 */
export function imageContentBox(img: HTMLImageElement): ImageContentBox {
  const cached = contentBoxes.get(img)
  if (cached) return cached

  const width = img.naturalWidth
  const height = img.naturalHeight
  const full: ImageContentBox = { sx: 0, sy: 0, sw: width, sh: height }
  if (!width || !height) return full

  let box = full
  try {
    // Measure at a capped resolution: margins only need to be located, and
    // scanning 4K of pixels on every theme load is not worth the precision.
    const maxSide = 512
    const ratio = Math.min(1, maxSide / Math.max(width, height))
    const w = Math.max(1, Math.round(width * ratio))
    const h = Math.max(1, Math.round(height * ratio))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (ctx) {
      ctx.drawImage(img, 0, 0, w, h)
      const { data } = ctx.getImageData(0, 0, w, h)
      let minX = w
      let minY = h
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        box = {
          sx: Math.floor((minX / w) * width),
          sy: Math.floor((minY / h) * height),
          sw: Math.ceil(((maxX - minX + 1) / w) * width),
          sh: Math.ceil(((maxY - minY + 1) / h) * height),
        }
      }
    }
  } catch {
    // Tainted canvas or no 2d context — fit the whole image.
  }

  contentBoxes.set(img, box)
  return box
}

/** Every image URL a theme references, across the frame and all surfaces. */
export function themeImageUrls(theme: {
  background?: { image?: { url: string } | null }
  textBox?: { image?: { url: string } | null }
  reference?: { surface?: { image?: { url: string } | null } }
  verseText?: { surface?: { image?: { url: string } | null } }
}): string[] {
  const urls = [
    theme.background?.image?.url,
    theme.textBox?.image?.url,
    theme.reference?.surface?.image?.url,
    theme.verseText?.surface?.image?.url,
  ]
  return urls.filter((url): url is string => Boolean(url))
}

/**
 * Load every image a theme needs. `onReady` fires once if anything had to be
 * fetched, so the caller can redraw.
 */
export function preloadThemeImages(
  theme: Parameters<typeof themeImageUrls>[0],
  onReady?: () => void
): void {
  const missing = themeImageUrls(theme).filter((url) => !cache.has(url))
  if (missing.length === 0) return
  void Promise.all(missing.map(loadThemeImage)).then(() => onReady?.())
}
