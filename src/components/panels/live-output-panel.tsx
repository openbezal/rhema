import { useEffect } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useBroadcastStore, useBibleStore } from "@/stores"
import { presentVerse, toVerseRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"

export function LiveOutputPanel() {
  const isLive = useBroadcastStore((s) => s.isLive)
  const autoLive = useBroadcastStore((s) => s.autoLive)
  const liveVerse = useBroadcastStore((s) => s.liveVerse)
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]

  // The live output renders only what was explicitly presented — it no longer
  // follows the preview selection, so detections can't override the operator.
  const verseData = isLive ? liveVerse : null

  // Refetch the live verse when the translation changes so the live output
  // text follows the new translation. Updates the live output only — the
  // preview keeps whatever the operator is browsing.
  useEffect(() => {
    const source = useBroadcastStore.getState().liveSourceVerse
    if (!source) return
    bibleActions
      .fetchVerse(source.book_number, source.chapter, source.verse)
      .then((v) => {
        if (!v) return
        const bible = useBibleStore.getState()
        const abbreviation =
          bible.translations.find((t) => t.id === bible.activeTranslationId)
            ?.abbreviation ?? "KJV"
        useBroadcastStore
          .getState()
          .setLiveVerse(toVerseRenderData(v, abbreviation), v)
      })
      .catch(() => {})
  }, [activeTranslationId])

  const handleGoLive = (checked: boolean) => {
    useBroadcastStore.getState().setLive(checked)
    // Going live with nothing presented yet: present the current preview
    // verse so the output isn't blank.
    if (checked && !useBroadcastStore.getState().liveVerse) {
      const selected = useBibleStore.getState().selectedVerse
      if (selected) void presentVerse(selected)
    }
  }

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
              "text-[0.625rem] font-medium uppercase tracking-wider transition-colors",
              autoLive ? "text-foreground" : "text-muted-foreground"
            )}
          >
            Auto
          </span>
          <Switch
            checked={autoLive}
            onCheckedChange={(checked) =>
              useBroadcastStore.getState().setAutoLive(checked)
            }
          />
        </label>
        <label className="ml-2 flex items-center gap-2">
          <span
            className={cn(
              "text-[0.625rem] font-medium uppercase tracking-wider transition-colors",
              isLive ? "text-emerald-400" : "text-muted-foreground"
            )}
          >
            {isLive ? "Live" : "Go live"}
          </span>
          <Switch
            checked={isLive}
            onCheckedChange={handleGoLive}
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
        <CanvasVerse theme={activeTheme} verse={verseData} />
      </div>
    </div>
  )
}
