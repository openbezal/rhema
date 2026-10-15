import { useEffect } from "react"
import { connectBibleNavigation } from "@/lib/bible-navigation"

export function useBibleNavigation() {
  useEffect(() => connectBibleNavigation(), [])
}
