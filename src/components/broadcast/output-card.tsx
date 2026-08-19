import { useState } from "react"
import {
  CopyIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RadioIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { cn } from "@/lib/utils"
import { ndiFrameRateToNumber, ndiResolutionDimensions } from "@/lib/broadcast-output-control"
import { useBroadcastStore } from "@/stores"
import type { BroadcastOutput, BroadcastOutputStatus } from "@/types"
import { MAIN_OUTPUT_ID } from "@/types"

interface OutputCardProps {
  output: BroadcastOutput
  status: BroadcastOutputStatus | undefined
  /** Human-readable monitor description, when the monitor list is known. */
  monitorLabel?: string
  onEdit: () => void
  onToggle: (enabled: boolean) => void
  onDuplicate: () => void
  onRemove: () => void
  busy?: boolean
}

function transportLabel(output: BroadcastOutput, monitorLabel: string | undefined): string {
  if (output.type === "display") {
    return monitorLabel ?? `Display ${output.monitorIndex + 1}`
  }
  const dims = ndiResolutionDimensions(output.ndi.resolution)
  const alpha = output.ndi.alphaMode === "noneOpaque" ? "opaque" : "alpha"
  return `NDI · ${output.ndi.sourceName} · ${dims.height}p${ndiFrameRateToNumber(output.ndi.frameRate)} · ${alpha}`
}

export function OutputCard({
  output,
  status,
  monitorLabel,
  onEdit,
  onToggle,
  onDuplicate,
  onRemove,
  busy = false,
}: OutputCardProps) {
  const themes = useBroadcastStore((s) => s.themes)
  const isLive = useBroadcastStore((s) => s.isLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const renameOutput = useBroadcastStore((s) => s.renameOutput)

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(output.name)

  const theme = themes.find((t) => t.id === output.themeId) ?? themes[0]
  const onAir = output.type === "display" ? (status?.previewOpen ?? false) : (status?.ndiActive ?? false)
  const isDefault = output.id === MAIN_OUTPUT_ID

  const commitRename = () => {
    const name = draftName.trim()
    if (name && name !== output.name) renameOutput(output.id, name)
    else setDraftName(output.name)
    setRenaming(false)
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-2.5 transition-colors hover:border-foreground/20">
      <div className="relative overflow-hidden rounded-md border border-foreground/10">
        {theme ? (
          <CanvasVerse
            theme={theme}
            verse={isLive && onAir ? liveVerse : null}
            className={cn("aspect-video w-full", !onAir && "opacity-45 saturate-50")}
          />
        ) : (
          <div className="aspect-video w-full bg-muted" />
        )}
        <span
          className={cn(
            "absolute top-1.5 left-1.5 inline-flex items-center gap-1.5 rounded-4xl border px-2 py-0.5 text-[0.625rem] font-semibold tracking-wider uppercase backdrop-blur-sm",
            onAir && output.type === "display" && "border-destructive/40 bg-destructive/15 text-destructive",
            onAir && output.type === "ndi" && "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
            !onAir && "border-border bg-background/70 text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              onAir && output.type === "display" && "animate-pulse bg-destructive",
              onAir && output.type === "ndi" && "bg-emerald-400",
              !onAir && "bg-muted-foreground"
            )}
          />
          {onAir ? (output.type === "display" ? "Live" : "Streaming") : "Off"}
        </span>
      </div>

      <div className="flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename()
                if (e.key === "Escape") {
                  setDraftName(output.name)
                  setRenaming(false)
                }
              }}
              className="h-6 px-1.5 py-0 text-sm"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{output.name}</span>
              {isDefault && (
                <Badge variant="outline" className="h-4 px-1.5 text-[0.5625rem] tracking-wider uppercase">
                  Default
                </Badge>
              )}
            </div>
          )}
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {output.type === "display" ? (
              <MonitorIcon className="size-3 shrink-0" />
            ) : (
              <RadioIcon className="size-3 shrink-0" />
            )}
            <span className="truncate">{transportLabel(output, monitorLabel)}</span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label={`${output.name} options`}
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <SettingsIcon className="size-3.5" />
              Edit settings
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDraftName(output.name)
                setRenaming(true)
              }}
            >
              <PencilIcon className="size-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <CopyIcon className="size-3.5" />
              Duplicate
            </DropdownMenuItem>
            {!isDefault && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2Icon className="size-3.5" />
                  Remove
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center justify-between px-0.5 pb-0.5">
        <span className="truncate text-[0.6875rem] text-muted-foreground">{theme?.name ?? "No theme"}</span>
        <Switch
          checked={onAir}
          disabled={busy}
          onCheckedChange={onToggle}
          aria-label={`${output.name} on air`}
        />
      </div>
    </div>
  )
}
