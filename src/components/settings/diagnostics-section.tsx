import { useEffect, useState } from "react"
import { DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { invoke } from "@tauri-apps/api/core"
import { getVersion } from "@tauri-apps/api/app"
import { appLogDir } from "@tauri-apps/api/path"
import { save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { useUpdateCheck } from "@/hooks/use-update-check"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** `null` means everything still on disk. */
const RANGES: { value: string; label: string; minutes: number | null }[] = [
  { value: "15", label: "Last 15 minutes", minutes: 15 },
  { value: "60", label: "Last hour", minutes: 60 },
  { value: "180", label: "Last 3 hours", minutes: 180 },
  { value: "all", label: "Everything", minutes: null },
]

/** `2026-08-19T14-05-33Z` — safe in a filename, sorts chronologically. */
function fileStamp(): string {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z")
}

export function DiagnosticsSection() {
  const [range, setRange] = useState("60")
  const [saving, setSaving] = useState(false)
  const [version, setVersion] = useState("")
  const [logDir, setLogDir] = useState("")
  const update = useUpdateCheck()
  // Narrowing on `update.status` does not survive into a callback, so bind the
  // available release to a local the closure can capture.
  const available = update.status?.isNewer ? update.status : null

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {})
    void appLogDir().then(setLogDir).catch(() => {})
  }, [])

  const handleSave = async () => {
    const selected = RANGES.find((r) => r.value === range)
    setSaving(true)
    try {
      const contents = await invoke<string>("export_diagnostics", {
        sinceMinutes: selected?.minutes ?? null,
      })
      const path = await save({
        defaultPath: `rhema-logs-${fileStamp()}.log`,
        filters: [{ name: "Log", extensions: ["log", "txt"] }],
      })
      // The user cancelled the save dialog.
      if (!path) return
      await writeTextFile(path, contents)
      toast.success("Logs saved", { description: path })
    } catch (error) {
      toast.error("Could not save logs", { description: String(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Save a copy of the app&apos;s logs to send with a bug report.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-1.5">
            <label
              id="log-range-label"
              className="text-xs font-medium text-muted-foreground"
            >
              Time range
            </label>
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger aria-labelledby="log-range-label" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <LoaderCircleIcon className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <DownloadIcon className="mr-1.5 size-3.5" />
            )}
            {saving ? "Saving…" : "Save logs…"}
          </Button>

          <p className="text-xs leading-relaxed text-muted-foreground">
            The file records what the app did, including short fragments of
            speech picked up by transcription. It never contains your API keys.
          </p>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground">Version</span>
            <span className="font-mono text-xs">{version || "—"}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-xs text-muted-foreground">Log folder</span>
            <span className="truncate font-mono text-[0.6875rem]" title={logDir}>
              {logDir || "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
            <span className="text-xs text-muted-foreground">
              {update.checking
                ? "Checking for updates…"
                : available
                  ? `Rhema ${available.latest} is available`
                  : update.status
                    ? "Up to date"
                    : "Update check unavailable"}
            </span>

            {available ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={() => {
                  void openUrl(available.url).catch((error: unknown) => {
                    toast.error("Could not open the release page", {
                      description: String(error),
                    })
                  })
                }}
              >
                <DownloadIcon className="mr-1 size-3" />
                Download
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                disabled={update.checking}
                onClick={() => void update.recheck()}
              >
                Check again
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
