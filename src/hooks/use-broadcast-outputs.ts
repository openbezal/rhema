import { useEffect } from "react"
import { connectBroadcastOutputs } from "@/lib/broadcast-output-session"
export function useBroadcastOutputs(): void {
  useEffect(() => connectBroadcastOutputs(), [])
}
