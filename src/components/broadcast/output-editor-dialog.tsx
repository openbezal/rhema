import { useState } from "react"
import { MonitorIcon, RadioIcon, RefreshCwIcon } from "lucide-react"
import type { Monitor } from "@tauri-apps/api/window"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  NDI_ALPHA_OPTIONS,
  NDI_FRAME_RATE_OPTIONS,
  NDI_RESOLUTION_OPTIONS,
} from "@/lib/broadcast-output-control"
import { useBroadcastStore } from "@/stores"
import type {
  BroadcastOutput,
  BroadcastOutputType,
  NdiAlphaMode,
  NdiFrameRate,
  NdiResolution,
} from "@/types"

interface OutputEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Omit to create a new output; provide one to edit it. */
  output?: BroadcastOutput
  /** Draft config for a new output (name/monitor defaults come from the grid). */
  draft: BroadcastOutput
  monitors: Monitor[]
  monitorsRefreshing: boolean
  onRefreshMonitors: () => void
  onSubmit: (output: BroadcastOutput) => void
}

const TYPE_OPTIONS: Array<{
  value: BroadcastOutputType
  label: string
  description: string
  icon: typeof MonitorIcon
}> = [
  {
    value: "display",
    label: "External Display",
    description: "Full-screen output on a connected monitor or projector.",
    icon: MonitorIcon,
  },
  {
    value: "ndi",
    label: "NDI Feed",
    description: "Network video source for OBS, vMix or TriCaster — supports alpha.",
    icon: RadioIcon,
  },
]

export function OutputEditorDialog({
  open,
  onOpenChange,
  output,
  draft,
  monitors,
  monitorsRefreshing,
  onRefreshMonitors,
  onSubmit,
}: OutputEditorDialogProps) {
  const themes = useBroadcastStore((s) => s.themes)
  const outputs = useBroadcastStore((s) => s.outputs)
  const isEditing = Boolean(output)

  const [form, setForm] = useState<BroadcastOutput>(output ?? draft)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever the dialog opens for a different output. Adjusting
  // state during render (rather than in an effect) avoids rendering the stale
  // form for a frame.
  const formKey = open ? (output?.id ?? `new:${draft.id}`) : "closed"
  const [lastFormKey, setLastFormKey] = useState(formKey)
  if (lastFormKey !== formKey) {
    setLastFormKey(formKey)
    if (open) {
      setForm(output ?? draft)
      setError(null)
    }
  }

  const patch = (updates: Partial<BroadcastOutput>) =>
    setForm((f) => ({ ...f, ...updates }))
  const patchNdi = (updates: Partial<BroadcastOutput["ndi"]>) =>
    setForm((f) => ({ ...f, ndi: { ...f.ndi, ...updates } }))

  const handleSubmit = () => {
    const name = form.name.trim()
    if (!name) {
      setError("Give this broadcast a name.")
      return
    }
    const sourceName = form.ndi.sourceName.trim()
    if (form.type === "ndi") {
      if (!sourceName) {
        setError("NDI feeds need a source name.")
        return
      }
      const clash = outputs.some(
        (o) => o.id !== form.id && o.type === "ndi" && o.ndi.sourceName.trim() === sourceName
      )
      if (clash) {
        setError("Another NDI feed already uses that source name.")
        return
      }
    }
    onSubmit({ ...form, name, ndi: { ...form.ndi, sourceName: sourceName || name } })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Broadcast settings" : "Add broadcast"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Change where this output goes and how it looks."
              : "Choose where this output goes. You can change everything later."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="output-name" className="text-xs text-muted-foreground">
              Name
            </label>
            <Input
              id="output-name"
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Stage Confidence Monitor"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Broadcast type</span>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.type === value}
                  onClick={() => patch({ type: value })}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
                    form.type === value
                      ? "border-lime-500/50 bg-lime-500/10"
                      : "border-border bg-card hover:border-foreground/20"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md border",
                      form.type === value
                        ? "border-lime-500/50 bg-lime-500/15 text-lime-400"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs leading-snug text-muted-foreground">{description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <span className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
              {form.type === "display" ? "Display settings" : "NDI settings"}
            </span>

            {form.type === "display" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Monitor</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={monitorsRefreshing}
                    onClick={onRefreshMonitors}
                    className="h-5 gap-1 px-1.5 text-[0.625rem] text-muted-foreground"
                  >
                    <RefreshCwIcon className={cn("size-3", monitorsRefreshing && "animate-spin")} />
                    Refresh
                  </Button>
                </div>
                <Select
                  value={String(form.monitorIndex)}
                  onValueChange={(value) => patch({ monitorIndex: Number(value) })}
                  disabled={monitors.length === 0}
                >
                  <SelectTrigger className="w-full" disabled={monitors.length === 0}>
                    <SelectValue
                      placeholder={monitors.length === 0 ? "No monitors detected" : "Select monitor"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {monitors.map((m, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {m.name} ({m.size.width}&times;{m.size.height})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ndi-source" className="text-xs text-muted-foreground">
                    Source name
                  </label>
                  <Input
                    id="ndi-source"
                    value={form.ndi.sourceName}
                    onChange={(e) => patchNdi({ sourceName: e.target.value })}
                    placeholder="Rhema Output"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Resolution</span>
                    <Select
                      value={form.ndi.resolution}
                      onValueChange={(v) => patchNdi({ resolution: v as NdiResolution })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_RESOLUTION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Frame rate</span>
                    <Select
                      value={form.ndi.frameRate}
                      onValueChange={(v) => patchNdi({ frameRate: v as NdiFrameRate })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NDI_FRAME_RATE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Alpha channel</span>
                  <Select
                    value={form.ndi.alphaMode}
                    onValueChange={(v) => patchNdi({ alphaMode: v as NdiAlphaMode })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NDI_ALPHA_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Theme</span>
              <Select value={form.themeId} onValueChange={(themeId) => patch({ themeId })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton={false}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>{isEditing ? "Save changes" : "Add broadcast"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
