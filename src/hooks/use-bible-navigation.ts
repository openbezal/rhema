import { useEffect } from "react"
import { connectBibleCatalog } from "@/lib/bible-catalog"
import { connectPreviewSelection } from "@/lib/preview-selection"
import { connectBibleNavigation } from "@/lib/bible-navigation"

export function useBibleNavigation() {
  useEffect(() => {
    const navigation = connectBibleNavigation()
    const preview = connectPreviewSelection()
    const catalog = connectBibleCatalog()
    return () => {
      catalog()
      preview()
      navigation()
    }
  }, [])
}
