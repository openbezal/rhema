import { useEffect, useMemo } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { ConfidenceDot } from "@/components/ui/confidence-dot"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { queueSuggestion } from "@/lib/suggestion-actions"
import { detectionCandidate } from "@/lib/suggestion-history"
import { PlayIcon, PlusIcon, XIcon } from "lucide-react"
import { useDetection, detectionActions } from "@/hooks/use-detection"
import { bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useDetectionStore } from "@/stores"
import { presentVerse } from "@/hooks/use-broadcast"
import { mark } from "@/lib/latency-marks"
import type { DetectionResult } from "@/types"

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
    <div className="group border-b border-border p-3 last:border-0">
      <div className="flex items-center gap-2">
        <ConfidenceDot confidence={detection.confidence} />
        <span className="flex-1 truncate text-sm font-semibold text-foreground">
          {detection.verse_ref}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Dismiss ${detection.verse_ref}`}
          title="Dismiss"
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() =>
            detectionActions.dismissDetection(
              detection.verse_ref,
              detection.source
            )
          }
        >
          <XIcon className="size-2.5" />
        </Button>
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
            void queueSuggestion({
              ...detectionCandidate(detection),
              firstSeenAt: Date.now(),
              lastSeenAt: Date.now(),
            }).catch((error: unknown) =>
              toast.error("Could not queue detection", {
                description:
                  error instanceof Error
                    ? error.message
                    : "Check the source translation.",
              })
            )
          }}
        >
          <PlusIcon className="size-3" />
          Queue
        </Button>
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

  // Spoken citations retain their own recent timeline; quotation matches have a separate snapshot.
  const directDetections = useMemo(
    () => detections.filter((d) => d.source === "direct"),
    [detections]
  )

  return (
    <div
      data-slot="detections-panel"
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Direct detections">
        <button
          onClick={() => useDetectionStore.getState().clearDirectDetections()}
          className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          Clear all
        </button>
      </PanelHeader>

      {directDetections.length === 0 ? (
        <p className="p-4 text-center text-xs text-muted-foreground">
          Spoken references will appear here during transcription
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {directDetections.map((detection) => (
            <DetectionCard
              key={`${detection.translation_code ?? "legacy"}|${detection.book_number}:${detection.chapter}:${detection.verse}`}
              detection={detection}
            />
          ))}
        </div>
      )}
    </div>
  )
}
