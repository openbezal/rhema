import { EraserIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useBroadcastStore } from "@/stores"
import { operatorActions } from "@/lib/operator-actions"

export function LiveOutputPanel() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const clearMode = useBroadcastStore((s) => s.clearMode)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]

  // The live output renders only what was explicitly presented — it no longer
  // follows the preview selection, so detections can't override the operator.
  const verseData = isLive ? liveVerse : null

  return (
    <div
      data-slot="live-output-panel"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        isLive && "shadow-[inset_0_2px_0_0_rgba(16,185,129,0.3)]"
      )}
    >
      <PanelHeader title="Live display">
        <label
          className="flex items-center gap-2"
          title="When on, detected verses are presented to the live display automatically. Turn off for manual control."
        >
          <span
            className={cn(
              "text-[0.625rem] font-medium tracking-wider uppercase transition-colors",
              autoLive ? "text-foreground" : "text-muted-foreground"
            )}
          >
            Auto
          </span>
          <Switch
            checked={autoLive}
            onCheckedChange={operatorActions.setAutoLive}
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Clear live content"
            title="Clear live content without stopping outputs"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <EraserIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => operatorActions.clearLive("transparent")}>
              Transparent
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => operatorActions.clearLive("black")}>
              Black
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => operatorActions.clearLive("background")}>
              Background only
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="ml-2 flex items-center gap-2">
          <span
            className={cn(
              "text-[0.625rem] font-medium tracking-wider uppercase transition-colors",
              isLive ? "text-emerald-400" : "text-muted-foreground"
            )}
          >
            {isLive ? "Live" : "Go live"}
          </span>
          <Switch
            checked={isLive}
            onCheckedChange={operatorActions.toggleOnAir}
            className="data-[state=checked]:bg-emerald-500"
          />
        </label>
      </PanelHeader>

      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-3 transition-opacity",
          !isLive && "opacity-40"
        )}
      >
        <CanvasVerse
          theme={activeTheme}
          verse={verseData}
          clearMode={clearMode}
        />
      </div>
    </div>
  )
}
