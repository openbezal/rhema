import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { PanelHeader } from "@/components/ui/panel-header"
import { LevelMeter } from "@/components/ui/level-meter"
import { Button } from "@/components/ui/button"
import { ApiKeyPrompt } from "@/components/ui/api-key-prompt"
import { MicIcon, MicOffIcon } from "lucide-react"
import {
  useAudioStore,
  useDetectionStore,
  useQueueStore,
  useBibleStore,
  useTranscriptStore,
} from "@/stores"
import { useTauriEvent } from "@/hooks/use-tauri-event"
import { useTranscription } from "@/hooks/use-transcription"
import { bibleActions } from "@/hooks/use-bible"
import type { DetectionResult } from "@/types"

/**
 * Leaf component that subscribes to the audio level only. Isolated so the
 * high-frequency `audio_level` tick (many times per second during recording)
 * does NOT re-render the transcript list, connection dot, or button subtree.
 */
function AudioLevelMeter() {
  const rms = useAudioStore((s) => s.level.rms)
  return <LevelMeter level={rms} bars={6} />
}

/**
 * Leaf component that subscribes to `currentPartial`. Partials update per audio tick.
 */
function LivePartialLine({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const currentPartial = useTranscriptStore((s) => s.currentPartial)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [currentPartial, scrollRef])

  if (!currentPartial) return null

  return (
    <p className="border-l-2 border-primary pl-2 text-base leading-relaxed text-foreground">
      {currentPartial}
      <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-primary align-middle" />
    </p>
  )
}

export function TranscriptPanel() {
  const [showKeyPrompt, setShowKeyPrompt] = useState(false)
  const onMissingApiKey = useCallback(() => setShowKeyPrompt(true), [])
  const {
    segments,
    isTranscribing,
    connectionStatus,
    startTranscription,
    stopTranscription,
  } = useTranscription({ onMissingApiKey })
  const hasPartial = useTranscriptStore((s) => s.currentPartial.length > 0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useTauriEvent<{ rms: number; peak: number }>("audio_level", (payload) => {
    useAudioStore.getState().setLevel(payload)
  })

  // Listen for voice translation commands: "read in NIV", "switch to ESV"
  useTauriEvent<{ abbreviation: string; translation_id: number }>(
    "translation_command",
    (data) => {
      useBibleStore.getState().setActiveTranslation(data.translation_id)
      console.log(`[VOICE] Translation switched to ${data.abbreviation}`)
    }
  )

  // Listen for detection results from the backend (batch replaces previous detections)
  useTauriEvent<DetectionResult[]>("verse_detections", (detections) => {
    useDetectionStore.getState().addDetections(detections)

    // Auto-navigate book search + select verse for preview/live
    // Auto-navigate on direct detection hits AND contextual navigation (reading mode chapter/verse commands)
    const directHit = detections.find(
      (d) => (d.source === "direct" || d.source === "contextual") && !d.is_chapter_only
    )
    if (directHit && directHit.book_number > 0) {
      // Select verse immediately so preview/live panels update
      bibleActions.selectVerse({
        id: 0,
        translation_id: useBibleStore.getState().activeTranslationId,
        book_number: directHit.book_number,
        book_name: directHit.book_name,
        book_abbreviation: "",
        chapter: directHit.chapter,
        verse: directHit.verse,
        text: directHit.verse_text,
      })
      // Navigate book search panel to this verse
      useBibleStore
        .getState()
        .setPendingNavigation({
          bookNumber: directHit.book_number,
          chapter: directHit.chapter,
          verse: directHit.verse,
        })
    }

    // Auto-queue high-confidence detections
    for (const d of detections) {
      // Check if this detection refines an existing chapter-only queue item
      if (
        !d.is_chapter_only &&
        d.source === "direct" &&
        useQueueStore
          .getState()
          .updateEarlyRef(
            d.book_number,
            d.chapter,
            d.verse,
            d.verse_ref,
            d.verse_text,
          )
      ) {
        continue
      }

      if (d.auto_queued) {
        const queue = useQueueStore.getState()
        // For chapter-only detections, match by book+chapter (any verse) to
        // avoid re-adding "Mark 1:1" when "Mark 1:2" already exists from a
        // previous chapter-only → refinement cycle.
        const dupIdx = d.is_chapter_only
          ? queue.items.findIndex(
              (i) =>
                i.verse.book_number === d.book_number &&
                i.verse.chapter === d.chapter,
            )
          : queue.findDuplicate(d.book_number, d.chapter, d.verse)
        if (dupIdx !== -1) {
          const existing = queue.items[dupIdx]
          queue.flashItem(existing.id)
          if (!d.is_chapter_only) queue.setActive(dupIdx)
          continue
        }
        queue.addItem({
          id: crypto.randomUUID(),
          verse: {
            id: 0,
            translation_id: 1,
            book_number: d.book_number,
            book_name: d.book_name,
            book_abbreviation: "",
            chapter: d.chapter,
            verse: d.verse,
            text: d.verse_text,
          },
          reference: d.verse_ref,
          confidence: d.confidence,
          source: d.source === "direct" ? "ai-direct" : "ai-semantic",
          added_at: Date.now(),
          is_chapter_only: d.is_chapter_only,
        })
      }
    }
  })

  // Auto-scroll on segment additions. Partial-driven scrolling lives in
  // LivePartialLine so the panel doesn't re-render per audio tick.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [segments])

  return (
    <div
      data-slot="transcript-panel"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader
        title="Live transcript"
        icon={<MicIcon className="size-3" />}
      >
        <div className="flex items-end gap-2 pb-px">
          {isTranscribing && (
            <span
              className={`mb-1 size-1.5 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-emerald-500"
                  : connectionStatus === "connecting"
                    ? "animate-pulse bg-amber-500"
                    : connectionStatus === "error"
                      ? "bg-red-500"
                      : "bg-muted-foreground/40"
              }`}
              title={connectionStatus}
            />
          )}
          <AudioLevelMeter />
        </div>
      </PanelHeader>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-3">
          {/* Faded top gradient */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-linear-to-b from-card to-transparent" />

          {segments.length === 0 && !hasPartial && !isTranscribing && (
            <p className="text-sm text-muted-foreground">
              Click "Start transcribing" to begin
            </p>
          )}

          {/* Final segments — recent ones brighter, older ones fade */}
          {segments.map((seg, idx) => {
            const distFromEnd = segments.length - 1 - idx
            const opacity =
              distFromEnd === 0
                ? "text-foreground/80"
                : distFromEnd === 1
                  ? "text-foreground/60"
                  : distFromEnd <= 3
                    ? "text-foreground/40"
                    : "text-foreground/25"
            return (
              <p
                key={seg.id}
                className={`text-sm leading-relaxed transition-colors duration-300 ${opacity}`}
              >
                {seg.text}
              </p>
            )
          })}

          {/* Partial (in-progress) text rendered by leaf subscriber */}
          <LivePartialLine scrollRef={scrollRef} />
        </div>
      </div>

      {/* Bottom control */}
      <div className="flex gap-2 border-t border-border px-3 py-2">
        {isTranscribing ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={stopTranscription}
          >
            <MicOffIcon className="size-3" />
            Stop transcribing
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={startTranscription}>
              <MicIcon className="size-3" />
            Start transcribing
          </Button>
        )}
      </div>

      <ApiKeyPrompt
        open={showKeyPrompt}
        onOpenChange={setShowKeyPrompt}
        service="Deepgram"
        description="Live transcription needs a Deepgram API key. Add it in settings so the app can start listening."
      />
    </div>
  )
}
