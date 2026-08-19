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
