import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useOperatorMaintenanceStore } from "@/lib/operator-maintenance"
import {
  getSessionResetRecoveryArchive,
  startNewSession,
} from "@/lib/session-reset-controller"
import { exportBeforeNewSession } from "@/lib/session-reset-files"
import { useNewSessionReadiness } from "@/hooks/use-new-session-readiness"

export function NewSessionDialog({
  disabled = false,
  onStarted,
}: {
  disabled?: boolean
  onStarted?: () => void
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null)
  const phase = useOperatorMaintenanceStore((state) => state.phase),
    maintenanceMessage = useOperatorMaintenanceStore((state) => state.message)
  const blocked = useNewSessionReadiness()
  const completed = useTranscriptStore(
    (state) => state.segments.filter((segment) => segment.is_final).length
  )
  const queue = useQueueStore((state) => state.items.length)
  const detections = useDetectionStore(
    (state) =>
      state.detections.filter((item) => item.source === "direct").length
  )
  const suggestions = useDetectionStore((state) => state.suggestions.length)
  const recoveryDocument =
    phase === "recovery" ? getSessionResetRecoveryArchive() : null
  const recovery = recoveryDocument !== null
  const locked = busy || exporting || recovery
  const counts = recoveryDocument
    ? {
        completed: recoveryDocument.transcript.length,
        queue: recoveryDocument.queue.length,
        detections: recoveryDocument.detections.filter(
          (item) => item.source === "direct"
        ).length,
        suggestions: recoveryDocument.suggestions.length,
      }
    : { completed, queue, detections, suggestions }
  async function apply() {
    if (locked || blocked) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await startNewSession()
      setOpen(false)
      setNotice(
        "New session started. Saved preferences and output assignments kept."
      )
      onStarted?.()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not start a new session. Try again."
      )
    } finally {
      setBusy(false)
    }
  }
  async function exportSnapshot(format: "archive" | "transcript") {
    if (busy || exporting) return
    setExporting(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await exportBeforeNewSession(format)
      setNotice(saved ? "Session export saved." : "Export cancelled.")
    } catch {
      setError(
        "Could not export the session. Try transcript TXT or another destination."
      )
    } finally {
      setExporting(false)
    }
  }
  return (
    <Dialog
      open={open || recovery}
      onOpenChange={(next) => {
        if (!next && locked) return
        setOpen(next)
        if (next) {
          setError(null)
          setNotice(null)
        }
      }}
    >
      <div className="space-y-2">
        <DialogTrigger asChild>
          <Button variant="outline" disabled={disabled || phase !== "idle"}>
            New session
          </Button>
        </DialogTrigger>
        {!open && !recovery && notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
      </div>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-xl"
        showCloseButton={!locked}
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (locked) event.preventDefault()
        }}
      >
        <DialogHeader className="border-b border-border p-5 pr-14">
          <DialogTitle>
            {recovery ? "Recover session before reload" : "Start a new session"}
          </DialogTitle>
          <DialogDescription>
            {recovery
              ? "The reset result is uncertain. Save the captured session before reloading."
              : "Review and export your current session before clearing it."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <li>
              {counts.completed} completed transcript segment
              {counts.completed === 1 ? "" : "s"}
            </li>
            <li>
              {counts.queue} Queue entr{counts.queue === 1 ? "y" : "ies"}
            </li>
            <li>
              {counts.detections} direct detection
              {counts.detections === 1 ? "" : "s"}
            </li>
            <li>
              {counts.suggestions} Suggestion
              {counts.suggestions === 1 ? "" : "s"}
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Starting a new session clears these histories, partial text,
            dismissals, reading context, the current preview and the held
            presentation.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Your saved preferences, API keys, microphone, output assignments,
            themes and Bible language choices stay in place. Auto and Follow
            stay as set.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Exports include the final transcript, Queue and candidate history.
            Keep a copy before clearing anything you need.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || exporting}
              onClick={() => void exportSnapshot("archive")}
            >
              Export session JSON
            </Button>
            <Button
              variant="outline"
              disabled={busy || exporting}
              onClick={() => void exportSnapshot("transcript")}
            >
              Export transcript TXT
            </Button>
          </div>
        </div>
        <DialogFooter className="flex-col border-t border-border p-5 sm:flex-col">
          {!busy && !recovery && blocked && (
            <p role="status" className="text-sm text-amber-500">
              {blocked}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              Starting new session…
            </p>
          )}
          {exporting && (
            <p role="status" className="text-sm text-muted-foreground">
              Saving session export…
            </p>
          )}
          {(error || (recovery && maintenanceMessage)) && (
            <p role="alert" className="text-sm break-words text-destructive">
              {recovery ? (maintenanceMessage ?? error) : error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            {recovery ? (
              <Button
                disabled={busy || exporting}
                onClick={() => window.location.reload()}
              >
                Reload Rhema
              </Button>
            ) : (
              <Button
                disabled={locked || Boolean(blocked)}
                onClick={() => void apply()}
              >
                Start new session
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
