import { AlertTriangleIcon } from "lucide-react"
import { useProfileStatusStore } from "@/lib/profile-status"

export function ProfileWarningBanner() {
  const readFailed = useProfileStatusStore((state) => state.readFailed)
  if (!readFailed) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-500"
    >
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span>
        Saved preferences could not be loaded. Settings shown here may be
        temporary. Restart Rhema to retry.
      </span>
    </div>
  )
}
