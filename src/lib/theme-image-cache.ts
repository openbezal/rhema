import { useEffect, useRef, useState } from "react"
import type { BroadcastTheme } from "@/types"

export function useThemeImageCache(theme: BroadcastTheme) {
  const cacheRef = useRef<Map<string, HTMLImageElement>>(new Map())
  const [imageVersion, setImageVersion] = useState(0)

  useEffect(() => {
    const imageUrl = theme.background.type === "image" ? theme.background.image?.url : null
    if (!imageUrl) return

    if (cacheRef.current.has(imageUrl)) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      cacheRef.current.set(imageUrl, image)
      setImageVersion((version) => version + 1)
    }
    image.onerror = () => {
      if (cancelled) return
      console.warn("[canvas-verse] failed to load background image", { url: imageUrl })
    }
    image.src = imageUrl

    return () => {
      cancelled = true
    }
  }, [theme.background])

  return {
    imageCache: cacheRef.current,
    imageVersion,
  }
}
