import { useEffect } from "react"
import { connectPresentationController } from "@/lib/presentation-controller"
export function usePresentationController(): void {
  useEffect(() => connectPresentationController(), [])
}
