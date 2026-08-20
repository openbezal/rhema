import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { openUrl } from "@tauri-apps/plugin-opener"
import { useUpdateCheck } from "@/hooks/use-update-check"

/**
 * Tells the operator once per launch that a newer release exists.
 *
 * Deliberately a toast rather than a persistent banner: this app is on screen
 * during live services, and a notice about an optional download must never
 * compete with the verse being broadcast. Dismissed is dismissed — it is not
 * shown again until the next launch, and Settings keeps the same information
 * available for anyone who wants it later.
 */
export function useUpdateNotice(): void {
  const { status } = useUpdateCheck()
  // Toast IDs are per-launch, and a re-render must not stack duplicates.
  const announced = useRef(false)

  useEffect(() => {
    if (!status?.isNewer || announced.current) return
    announced.current = true

    toast.info(`Rhema ${status.latest} is available`, {
      description: `You are running ${status.current}.`,
      duration: 15_000,
      action: {
        label: "Download",
        onClick: () => {
          void openUrl(status.url).catch((error: unknown) => {
            console.warn("[UPDATE] could not open release page:", error)
          })
        },
      },
    })
  }, [status])
}
