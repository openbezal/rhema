import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  downloadRelease,
  getReleaseNotice,
  retryReleaseNotice,
  useReleaseNoticeStore,
} from "@/lib/release-notice"
export function ReleaseNoticeRow() {
  const { checking, notice } = useReleaseNoticeStore()
  useEffect(() => {
    void getReleaseNotice()
  }, [])
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p role="status" className="text-xs text-muted-foreground">
        {checking
          ? "Checking for updates…"
          : notice?.status === "available"
            ? `Rhema ${notice.latest_version} is available`
            : notice?.status === "current"
              ? "Up to date"
              : "Update check unavailable"}
      </p>
      <div className="flex flex-wrap gap-2">
        {notice?.status === "available" && (
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => void downloadRelease(notice)}
          >
            Download
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => void retryReleaseNotice()}
        >
          Check again
        </Button>
      </div>
      {notice?.status === "available" && (
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          Download opens the release page in your browser.
        </p>
      )}
    </div>
  )
}
