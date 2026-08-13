import { useEffect, useMemo } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { Button } from "@/components/ui/button"
import { PlayIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDetection, detectionActions } from "@/hooks/use-detection"
import { bibleActions } from "@/hooks/use-bible"
import { useQueueStore, useBibleStore } from "@/stores"
import { presentVerse } from "@/hooks/use-broadcast"
import { mark } from "@/lib/latency-marks"
import type { DetectionResult } from "@/types"

const SOURCE_COLORS: Record<string, { text: string; label: string }> = {
  direct: { text: "text-green-600", label: "Direct" },
  semantic: { text: "text-indigo-300", label: "Semantic" },
}

function DetectionCard({ detection }: { detection: DetectionResult }) {
  const handlePresent = () => {
    // Navigate book search panel to this verse
    if (detection.book_number > 0) {
      bibleActions.navigateToVerse(
        detection.book_number,
        detection.chapter,
        detection.verse
      )
    }
    // Refetch full verse text, select for preview, and set live
    void presentVerse({
      id: 0,
      translation_id: useBibleStore.getState().activeTranslationId,
      book_number: detection.book_number,
      book_name: detection.book_name,
      book_abbreviation: "",
      chapter: detection.chapter,
      verse: detection.verse,
      text: detection.verse_text,
    })
  }

  return (
    <div className="border-b border-border p-3 last:border-0">
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={detection.confidence} />
        <span className="text-sm font-semibold text-foreground">
          {detection.verse_ref}
        </span>
      </div>

      {detection.verse_text && (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {detection.verse_text}
        </p>
      )}

      <div className="mt-2 flex gap-2">
        <Button size="sm" className="gap-1" onClick={handlePresent}>
          <PlayIcon className="size-3" />
          Present
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => {
            useQueueStore.getState().addItem({
              id: crypto.randomUUID(),
              verse: {
                id: 0,
                translation_id: useBibleStore.getState().activeTranslationId,
                book_number: detection.book_number,
                book_name: detection.book_name,
                book_abbreviation: "",
                chapter: detection.chapter,
                verse: detection.verse,
                text: detection.verse_text,
              },
              reference: detection.verse_ref,
              confidence: detection.confidence,
              source: detection.source === "direct" ? "ai-direct" : "ai-semantic",
              added_at: Date.now(),
            })
          }}
        >
          <PlusIcon className="size-3" />
          Queue
        </Button>
      </div>
    </div>
  )
}

function DetectionColumn({
  source,
  detections,
}: {
  source: "direct" | "semantic"
  detections: DetectionResult[]
}) {
  const style = SOURCE_COLORS[source]
  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-card px-3 py-1.5">
        <span
          className={cn(
            "text-[0.5625rem] font-medium uppercase tracking-wider",
            style.text
          )}
        >
          {style.label}
        </span>
        <span className="text-[0.5625rem] text-muted-foreground">
          {detections.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {detections.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            No {style.label.toLowerCase()} detections yet
          </p>
        ) : (
          detections.map((detection, i) => (
            <DetectionCard key={`${detection.verse_ref}-${i}`} detection={detection} />
          ))
        )}
      </div>
    </div>
  )
}

export function DetectionsPanel() {
  const { detections } = useDetection()

  // Latency debugging: when the list changes, mark the React commit and the
  // next animation frame (≈ actual pixels on screen).
  useEffect(() => {
    if (detections.length === 0) return
    mark(
      `detections-commit n=${detections.length} first=${detections[0]?.verse_ref ?? ""} src=${detections[0]?.source ?? "?"}`
    )
    const raf = requestAnimationFrame(() => mark("detections-paint"))
    return () => cancelAnimationFrame(raf)
  }, [detections])

  // Issue #104: direct (spoken references) and semantic (quoted text)
  // detections in separate columns, so a burst of direct hits doesn't push
  // the semantic ones out of view.
  const directDetections = useMemo(
    () => detections.filter((d) => d.source === "direct"),
    [detections]
  )
  const semanticDetections = useMemo(
    () => detections.filter((d) => d.source !== "direct"),
    [detections]
  )

  return (
    <div
      data-slot="detections-panel"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Recent detections">
        <button
          onClick={() => detectionActions.clearDetections()}
          className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear all
        </button>
      </PanelHeader>

      {detections.length === 0 ? (
        <p className="p-4 text-center text-xs text-muted-foreground">
          Verse detections will appear here during transcription
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
          <DetectionColumn source="direct" detections={directDetections} />
          <DetectionColumn source="semantic" detections={semanticDetections} />
        </div>
      )}
    </div>
  )
}
