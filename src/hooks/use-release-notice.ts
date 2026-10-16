import { useEffect } from "react"
import { showStartupReleaseNotice } from "@/lib/release-notice"
export function useReleaseNotice(): void {
  useEffect(() => {
    void showStartupReleaseNotice()
  }, [])
}
