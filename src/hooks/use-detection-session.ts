import { useEffect } from "react"
import { connectDetectionSession } from "@/lib/detection-session"
import { observeLongTasks } from "@/lib/latency-marks"
export function useDetectionSession(): void {
  useEffect(() => {
    observeLongTasks()
    return connectDetectionSession()
  }, [])
}
