import { shortcutHint } from "@/lib/shortcut-registry"
import { useActiveBroadcastTheme } from "@/hooks/use-broadcast"
import { BroadcastLanguageSelector } from "@/components/broadcast/broadcast-language-selector"
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
import { MISSING_OUTPUT_RENDERER_ERROR } from "@/types"
import { operatorActions } from "@/lib/operator-actions"

export function LiveOutputPanel() {
  const canClear = useBroadcastStore((s) => !Object.values(s.outputStatus).some((status) => status.error === MISSING_OUTPUT_RENDERER_ERROR))
  const recovery = useBroadcastStore((s) => s.presentationRecovery)
  const isLive = useBroadcastStore((s) => s.isLive)
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const clearMode = useBroadcastStore((s) => s.clearMode)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)

  const activeTheme = useActiveBroadcastTheme()

  // The live output renders only what was explicitly presented — it no longer
  // follows the preview selection, so detections can't override the operator.
  const verseData = isLive ? liveVerse : null

  return (
    <div
      data-slot="live-output-panel"
      tabIndex={-1}
      aria-label="Live Output panel"
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
            disabled={recovery !== "ready"}
            checked={autoLive}
            onCheckedChange={operatorActions.setAutoLive}
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!canClear}
            aria-label="Clear live content"
            title="Clear live content without stopping outputs"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <EraserIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => operatorActions.clearLive("transparent")}
            >
              Transparent
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => operatorActions.clearLive("black")}
            >
              Black
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => operatorActions.clearLive("background")}
            >
              Background only
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <label
          className="ml-2 flex items-center gap-2"
          title={`Toggle live output (${shortcutHint("toggle-live")})`}
        >
          <span
            className={cn(
              "text-[0.625rem] font-medium tracking-wider uppercase transition-colors",
              isLive ? "text-emerald-400" : "text-muted-foreground"
            )}
          >
            {recovery !== "ready" ? "Status unknown" : isLive ? "Live" : "Go live"}
          </span>
          <Switch
            disabled={recovery !== "ready"}
            checked={isLive}
            onCheckedChange={operatorActions.toggleOnAir}
            className="data-[state=checked]:bg-emerald-500"
          />
        </label>
      </PanelHeader>
      <BroadcastLanguageSelector />

      {recovery !== "ready" && <p role="status" className="px-3 pt-2 text-xs text-amber-400">
        {canClear ? "Output content could not be restored. Existing output is held. Use Clear to establish known content, or stop the output in Settings." : "Output renderer is unavailable. Stop the affected output in Settings before presenting new content."}
      </p>}
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-3 transition-opacity",
          !isLive && "opacity-40"
        )}
      >
        {recovery === "ready" ? <CanvasVerse
          theme={activeTheme}
          verse={verseData}
          clearMode={clearMode}
        /> : <span className="text-sm text-muted-foreground">Preview unavailable</span>}
      </div>
    </div>
  )
}
