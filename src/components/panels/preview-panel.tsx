import { useEffect, useState, useCallback } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { CanvasVerse } from "@/components/ui/canvas-verse"
import { useBibleStore, useBroadcastStore, useQueueStore } from "@/stores"
import { bibleActions } from "@/hooks/use-bible"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { usePrediction } from "@/hooks/use-prediction"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PredictionResult } from "@/types"

function PredictionCard({
  prediction,
  onAdd,
}: {
  prediction: PredictionResult
  onAdd: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center justify-between rounded-md border border-border p-2 transition-colors",
        hovered && "border-primary/50 bg-muted/50"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onAdd}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{prediction.verse_ref}</p>
        <p className="truncate text-[0.625rem] text-muted-foreground">
          {prediction.strategy}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[0.625rem] text-muted-foreground">
          {Math.round(prediction.confidence * 100)}%
        </span>
        {hovered && (
          <Button
            variant="ghost"
            size="xs"
            className="h-5 px-1 text-[0.625rem]"
          >
            Add
          </Button>
        )}
      </div>
    </div>
  )
}

export function PreviewPanel() {
  const selectedVerse = useBibleStore((s) => s.selectedVerse)
  const translations = useBibleStore((s) => s.translations)
  const activeTranslationId = useBibleStore((s) => s.activeTranslationId)
  const { predictions, fetchPredictions } = usePrediction()

  // When translation changes, re-fetch the selected verse in the new translation
  useEffect(() => {
    const verse = useBibleStore.getState().selectedVerse
    if (
      verse &&
      verse.book_number > 0 &&
      verse.chapter > 0 &&
      verse.verse > 0
    ) {
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
  const translation =
    translations.find((t) => t.id === activeTranslationId)?.abbreviation ??
    "KJV"

  const verseData = selectedVerse
    ? toVerseRenderData(selectedVerse, translation)
    : null

  const handleFetchPredictions = useCallback(async () => {
    await fetchPredictions(3)
  }, [fetchPredictions])

  const handleAddPrediction = useCallback(
    async (prediction: PredictionResult) => {
      const verse = {
        id: 0,
        book_number: prediction.book_number,
        book_name: prediction.book_name,
        chapter: prediction.chapter,
        verse: prediction.verse,
        text: prediction.verse_text,
      }
      await bibleActions.fetchVerse(
        prediction.book_number,
        prediction.chapter,
        prediction.verse
      )
      useBroadcastStore
        .getState()
        .setLiveVerse(toVerseRenderData(verse, translation))
      useQueueStore.getState().addItem({
        id: `pred-${Date.now()}`,
        reference: prediction.verse_ref,
        verse: verse,
        source: "manual",
      })
    },
    [translation]
  )

  return (
    <div
      data-slot="preview-panel"
      className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Program preview">
        <button
          onClick={handleFetchPredictions}
          className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Predict
        </button>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-1 items-center justify-center">
          <CanvasVerse theme={activeTheme} verse={verseData} />
        </div>
        {predictions.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-[0.625rem] font-medium text-muted-foreground">
              Upcoming
            </p>
            {predictions.map((p, idx) => (
              <PredictionCard
                key={`${p.verse_ref}-${idx}`}
                prediction={p}
                onAdd={() => handleAddPrediction(p)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
