import { useActiveBroadcastTheme } from "@/hooks/use-broadcast"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore } from "@/stores"
import { useBilingualPreview } from "@/hooks/use-bilingual-preview"

export function PreviewPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)

  const activeTheme = useActiveBroadcastTheme()
  const verseData = useBilingualPreview(selectedVerse)

  return (
    <div
      data-slot="preview-panel"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Program preview" />
      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <CanvasVerse theme={activeTheme} verse={verseData} />
      </div>
    </div>
  )
}
