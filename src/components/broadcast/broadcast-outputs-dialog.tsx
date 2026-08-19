import { useCallback, useEffect, useMemo, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { info as logInfo, error as logError } from "@tauri-apps/plugin-log"
import { availableMonitors, type Monitor } from "@tauri-apps/api/window"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  disableOutput,
  enableOutput,
  reconcileOutputStatus,
} from "@/lib/broadcast-output-control"
import { useBroadcastStore } from "@/stores"
import type { BroadcastOutput } from "@/types"
import { MAIN_OUTPUT_ID, defaultNdiSettings } from "@/types"
import { OutputCard } from "./output-card"
import { OutputEditorDialog } from "./output-editor-dialog"

const RECONCILE_INTERVAL_MS = 750

/** First monitor not already claimed by another display output. */
function firstFreeMonitorIndex(outputs: BroadcastOutput[], monitorCount: number): number {
  const taken = new Set(
    outputs.filter((o) => o.type === "display").map((o) => o.monitorIndex)
  )
  for (let i = 0; i < Math.max(monitorCount, 1); i++) {
    if (!taken.has(i)) return i
  }
  return 0
}

function nextOutputName(outputs: BroadcastOutput[]): string {
  const taken = new Set(outputs.map((o) => o.name))
  for (let n = 2; ; n++) {
    const name = `Broadcast ${n}`
    if (!taken.has(name)) return name
  }
}

export function BroadcastOutputsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const outputs = useBroadcastStore((s) => s.outputs)
  const outputStatus = useBroadcastStore((s) => s.outputStatus)
  const themes = useBroadcastStore((s) => s.themes)

  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [monitorsRefreshing, setMonitorsRefreshing] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<string[]>([])

  const fetchMonitors = useCallback(async () => {
    setMonitorsRefreshing(true)
    try {
      const result = await availableMonitors()
      void logInfo(
        `[broadcast-ui] availableMonitors -> ${result.length}: ${result
          .map((m) => `${m.name ?? "?"} ${m.size.width}x${m.size.height}`)
          .join(", ")}`,
      )
      setMonitors(result)
    } catch (error) {
      void logError(`[broadcast-ui] availableMonitors FAILED: ${String(error)}`)
      toast.error("Could not list monitors", { description: String(error) })
      setMonitors([])
    } finally {
      setMonitorsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (open) void fetchMonitors()
  }, [open, fetchMonitors])

  // Keep the cards in sync with reality: a projector closed at the OS level
  // (or an NDI sender that died) must flip its card back to Off.
  useEffect(() => {
    if (!open) return

    const reconcileAll = () => {
      for (const output of useBroadcastStore.getState().outputs) {
        void reconcileOutputStatus(output)
      }
    }

    reconcileAll()
    const intervalId = setInterval(reconcileAll, RECONCILE_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [open])

  const editingOutput = editingId ? outputs.find((o) => o.id === editingId) : undefined

  // The draft id doubles as the editor's form identity, so it must stay stable
  // for as long as the editor is open — regenerating it (e.g. when a monitor is
  // plugged in, or a remote sets the theme) would wipe what the user is typing.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  const newOutputDraft = useMemo<BroadcastOutput>(() => {
    const name = nextOutputName(outputs)
    return {
      id: draftId,
      name,
      type: "display",
      themeId: outputs.find((o) => o.id === MAIN_OUTPUT_ID)?.themeId ?? themes[0]?.id ?? "",
      monitorIndex: firstFreeMonitorIndex(outputs, monitors.length),
      ndi: defaultNdiSettings(name),
    }
  }, [draftId, outputs, themes, monitors.length])

  const withBusy = async (id: string, action: () => Promise<unknown>) => {
    setBusyIds((ids) => [...ids, id])
    try {
      await action()
    } finally {
      setBusyIds((ids) => ids.filter((busyId) => busyId !== id))
    }
  }

  const handleToggle = (output: BroadcastOutput, enabled: boolean) =>
    void withBusy(output.id, () => (enabled ? enableOutput(output) : disableOutput(output)))

  const handleRemove = (output: BroadcastOutput) =>
    void withBusy(output.id, async () => {
      // Stop the transport first: close_broadcast_window only hides the window
      // while NDI is still running for that output.
      await disableOutput(output)
      useBroadcastStore.getState().removeOutput(output.id)
      toast.success(`Removed ${output.name}`)
    })

  const handleEditorSubmit = (next: BroadcastOutput) => {
    const store = useBroadcastStore.getState()
    const existing = store.outputs.find((o) => o.id === next.id)

    if (!existing) {
      store.addOutput(next)
      setDraftId(crypto.randomUUID())
      setEditingId(null)
      return
    }

    const status = store.outputStatus[next.id]
    const wasOnAir = (status?.previewOpen ?? false) || (status?.ndiActive ?? false)
    const transportChanged =
      existing.type !== next.type ||
      existing.monitorIndex !== next.monitorIndex ||
      existing.ndi.sourceName !== next.ndi.sourceName ||
      existing.ndi.resolution !== next.ndi.resolution ||
      existing.ndi.frameRate !== next.ndi.frameRate ||
      existing.ndi.alphaMode !== next.ndi.alphaMode

    void withBusy(next.id, async () => {
      if (wasOnAir && transportChanged) await disableOutput(existing)
      useBroadcastStore.getState().updateOutput(next.id, {
        name: next.name,
        type: next.type,
        themeId: next.themeId,
        monitorIndex: next.monitorIndex,
        ndi: next.ndi,
      })
      if (wasOnAir && transportChanged) {
        const updated = useBroadcastStore.getState().outputs.find((o) => o.id === next.id)
        if (updated) await enableOutput(updated)
      }
    })
    setEditingId(null)
  }

  const monitorLabel = (output: BroadcastOutput) => {
    const monitor = monitors[output.monitorIndex]
    if (!monitor) return undefined
    return `${monitor.name ?? `Display ${output.monitorIndex + 1}`} · ${monitor.size.width}×${monitor.size.height}`
  }

  const onAirCount = outputs.filter((o) => {
    const status = outputStatus[o.id]
    return o.type === "display" ? status?.previewOpen : status?.ndiActive
  }).length

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="gap-4 sm:max-w-[840px]">
          <DialogHeader>
            <DialogTitle>Broadcast</DialogTitle>
            <DialogDescription>
              Manage your outputs — external displays and NDI feeds all show the current live
              verse, each with its own theme.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[64vh] pr-3">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {outputs.map((output) => (
                <OutputCard
                  key={output.id}
                  output={output}
                  status={outputStatus[output.id]}
                  monitorLabel={monitorLabel(output)}
                  busy={busyIds.includes(output.id)}
                  onEdit={() => {
                    setEditingId(output.id)
                    setEditorOpen(true)
                  }}
                  onToggle={(enabled) => handleToggle(output, enabled)}
                  onDuplicate={() => useBroadcastStore.getState().duplicateOutput(output.id)}
                  onRemove={() => handleRemove(output)}
                />
              ))}

              <button
                type="button"
                onClick={() => {
                  setEditingId(null)
                  setEditorOpen(true)
                }}
                className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-lime-500/50 hover:bg-lime-500/5 hover:text-lime-400 focus-visible:border-lime-500/50 focus-visible:text-lime-400 focus-visible:outline-none"
              >
                <span className="flex size-8 items-center justify-center rounded-full border border-current">
                  <PlusIcon className="size-4" />
                </span>
                <span className="text-xs font-medium">Add broadcast</span>
              </button>
            </div>
          </ScrollArea>

          <p className="text-xs text-muted-foreground">
            {onAirCount} of {outputs.length} {outputs.length === 1 ? "output" : "outputs"} on air
          </p>
        </DialogContent>
      </Dialog>

      <OutputEditorDialog
        open={editorOpen}
        onOpenChange={(next) => {
          setEditorOpen(next)
          if (!next) setEditingId(null)
        }}
        output={editingOutput}
        draft={newOutputDraft}
        monitors={monitors}
        monitorsRefreshing={monitorsRefreshing}
        onRefreshMonitors={() => void fetchMonitors()}
        onSubmit={handleEditorSubmit}
      />
    </>
  )
}
