import { useEffect } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { Button } from "@/components/ui/button"
import { MonitorUpIcon } from "lucide-react"
import { useBibleStore, useBroadcastStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { presentVerse, toVerseRenderData } from "@/hooks/use-broadcast"

export function PreviewPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)

  // When translation changes, re-fetch the selected verse in the new translation
  useEffect(() => {
    const verse = useBibleStore.getState().selectedVerse
    if (verse && verse.book_number > 0 && verse.chapter > 0 && verse.verse > 0) {
      bibleActions
        .fetchVerse(verse.book_number, verse.chapter, verse.verse)
        .then((v) => {
          if (v) bibleActions.selectVerse(v)
        })
        .catch(() => {})
    }
  }, [activeTranslationId])
  const themes = useBroadcastStore((s) => s.themes)
  const activeThemeId = useBroadcastStore((s) => s.activeThemeId)

  const activeTheme = themes.find((t) => t.id === activeThemeId) ?? themes[0]
  const translation = translations.find((t) => t.id === activeTranslationId)?.abbreviation ?? "KJV"

  const verseData = selectedVerse ? toVerseRenderData(selectedVerse, translation) : null

  return (
    <div
      data-slot="preview-panel"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Program preview">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[0.625rem] font-medium uppercase tracking-wider"
          disabled={!selectedVerse}
          onClick={() => {
            const verse = useBibleStore.getState().selectedVerse
            if (verse) void presentVerse(verse)
          }}
          title="Present this verse on the live display"
        >
          <MonitorUpIcon className="size-3" />
          Send to live
        </Button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <CanvasVerse theme={activeTheme} verse={verseData} />
      </div>
    </div>
  )
}
