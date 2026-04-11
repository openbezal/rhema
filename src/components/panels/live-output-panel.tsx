import { useEffect } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { cn } from "@/lib/utils"
import { resolveRenderableTheme } from "@/lib/renderable-theme"
import { useBroadcastStore, useBibleStore } from "@/stores"
import { deriveLiveVerse } from "@/hooks/use-broadcast"

export function LiveOutputPanel() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const draftTheme = useBroadcastStore((s) => s.draftTheme)
  const editingThemeId = useBroadcastStore((s) => s.editingThemeId)

  // Read the same data source as the preview panel
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)

  const activeTheme = resolveRenderableTheme({
    themes,
    themeId: activeThemeId,
    draftTheme,
    editingThemeId,
  })
  const translation =
    translations.find((t) => t.id === activeTranslationId)?.abbreviation ?? "KJV"

  const verseData = deriveLiveVerse({
    isLive,
    selectedVerse,
    translation,
  })

  useEffect(() => {
    useBroadcastStore.getState().setLiveVerse(verseData)
  }, [verseData])

  return (
    <div
      data-slot="live-output-panel"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        isLive && "shadow-[inset_0_2px_0_0_rgba(16,185,129,0.3)]"
      )}
    >
      <PanelHeader title="Live display">
        <button
          onClick={() => useBroadcastStore.getState().setLive(!isLive)}
          className={cn(
            "flex items-center gap-2 rounded-full px-2.5 py-1 text-[0.625rem] font-medium uppercase tracking-wider transition-all",
            isLive
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isLive
                ? "animate-pulse bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                : "bg-muted-foreground/50"
            )}
          />
          {isLive ? "Live" : "Go live"}
        </button>
      </PanelHeader>

      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center p-3 transition-opacity",
          !isLive && "opacity-40"
        )}
      >
        <CanvasVerse theme={activeTheme} verse={verseData} />
      </div>
    </div>
  )
}
