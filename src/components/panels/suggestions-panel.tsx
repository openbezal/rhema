import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PanelHeader } from "@/components/ui/panel-header"
import { useDetectionStore } from "@/stores/detection-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useBibleStore } from "@/stores/bible-store"
import { presentSuggestion, queueSuggestion } from "@/lib/suggestion-actions"
import {
  suggestionKey,
  type SuggestionCandidate,
} from "@/lib/suggestion-history"
import { translationCode } from "@/lib/translation-selection"

function SuggestionCard({
  candidate,
  onDismiss,
}: {
  candidate: SuggestionCandidate
  onDismiss: () => void
}) {
  const translations = useBibleStore((state) => state.translations)
  const known = translations.some(
    (item) =>
      item.is_downloaded && translationCode(item) === candidate.translation_code
  )
  const [busy, setBusy] = useState(false)
  const label =
    candidate.score_kind === "fts_rank"
      ? "Keyword search"
      : candidate.score_kind === "cosine"
        ? `Vector similarity ${candidate.confidence.toFixed(2)}`
        : candidate.score_kind === "hybrid"
          ? "Combined search"
          : "Search match"
  async function actOnCandidate(action: "present" | "queue") {
    setBusy(true)
    try {
      if (action === "present") await presentSuggestion(candidate)
      else if (await queueSuggestion(candidate))
        toast.success(`${candidate.verse_ref} queued`)
    } catch (error) {
      toast.error(`Could not ${action} suggestion`, {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the translation.",
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      data-suggestion-key={suggestionKey(candidate)}
      className="border-b border-border p-3 last:border-0"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{candidate.verse_ref}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {candidate.translation_code === "UNKNOWN"
            ? "Unknown translation"
            : candidate.translation_code}
        </span>
      </div>
      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        {candidate.verse_text}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!known || busy}
          onClick={() => void actOnCandidate("present")}
        >
          Present
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!known || busy}
          onClick={() => void actOnCandidate("queue")}
        >
          Queue
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Dismiss ${candidate.translation_code} ${candidate.verse_ref}`}
          onClick={onDismiss}
        >
          Dismiss
        </Button>
      </div>
      {!known && (
        <p className="mt-2 text-xs text-muted-foreground">
          This candidate's translation must be available before it can be used.
        </p>
      )}
    </article>
  )
}

export function SuggestionsPanel() {
  const available = useDetectionStore((state) => state.suggestions)
  const prune = useDetectionStore((state) => state.pruneSuggestions)
  const retentionMs = useSettingsStore((state) => state.suggestionRetentionMs)
  const capacity = useSettingsStore((state) => state.suggestionCapacity)
  const [visible, setVisible] = useState(() => available)
  const [hovered, setHovered] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  // Freshness can advance without replacing displayed text or ordering.
  const freshness = useRef(new Map<string, number>())
  const [held, setHeld] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frozen = hovered || held || scrolling
  const snapshot = new Map(visible.map((item) => [suggestionKey(item), item]))
  const pending = available.filter(
    (item) => snapshot.get(suggestionKey(item)) !== item
  ).length
  useEffect(() => {
    const release = () => setHeld(false)
    const blur = () => {
      setHeld(false)
      setHovered(false)
    }
    window.addEventListener("pointerup", release)
    window.addEventListener("pointercancel", release)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("pointerup", release)
      window.removeEventListener("pointercancel", release)
      window.removeEventListener("blur", blur)
      if (scrollTimer.current) clearTimeout(scrollTimer.current)
    }
  }, [])
  useEffect(() => {
    const recent = new Map(
      available.map((item) => [suggestionKey(item), item.lastSeenAt])
    )
    const previous = freshness.current
    freshness.current = new Map(
      visible.map((item) => {
        const key = suggestionKey(item)
        return [
          key,
          Math.max(
            item.lastSeenAt,
            previous.get(key) ?? 0,
            recent.get(key) ?? 0
          ),
        ]
      })
    )
  }, [available, visible])
  useEffect(() => {
    prune()
  }, [prune, capacity, retentionMs])
  useEffect(() => {
    const timer = setInterval(() => {
      prune()
      // Removing a focused card need not emit blur; consult the actual DOM.
      if (!frozen && !panelRef.current?.contains(document.activeElement))
        setVisible((previous) => {
          const retained = previous.filter(
            (item) =>
              Date.now() -
                (freshness.current.get(suggestionKey(item)) ??
                  item.lastSeenAt) <
              retentionMs
          )
          return retained.length === previous.length ? previous : retained
        })
    }, 1_000)
    return () => clearInterval(timer)
  }, [frozen, prune, retentionMs])
  return (
    <section
      ref={panelRef}
      data-slot="suggestions-panel"
      aria-label="Suggestions"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={(event) => {
        if ((event.target as HTMLElement).closest("[data-suggestion-key]"))
          setHeld(true)
      }}
    >
      <PanelHeader title="Suggestions">
        <Button
          size="sm"
          variant="outline"
          disabled={pending === 0 || held || scrolling}
          onClick={() => {
            prune()
            setVisible(useDetectionStore.getState().suggestions)
          }}
        >
          Apply updates ({pending})
        </Button>
      </PanelHeader>
      <p role="status" aria-live="polite" className="sr-only">
        {pending} updates available
      </p>
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        <p>Quotation matches. Present uses the primary translation.</p>
        <button
          className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => {
            useDetectionStore.getState().clearSuggestions()
            setVisible([])
          }}
        >
          Clear
        </button>
      </div>
      <div
        aria-label="Suggestion results"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:outline-ring"
        onScroll={() => {
          setScrolling(true)
          if (scrollTimer.current) clearTimeout(scrollTimer.current)
          scrollTimer.current = setTimeout(() => {
            scrollTimer.current = null
            setScrolling(false)
          }, 250)
        }}
      >
        {visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {pending > 0
              ? "Apply updates to inspect new suggestions."
              : "Quotation matches will appear during transcription."}
          </p>
        ) : (
          visible.map((candidate) => (
            <SuggestionCard
              key={suggestionKey(candidate)}
              candidate={candidate}
              onDismiss={() => {
                const key = suggestionKey(candidate)
                useDetectionStore.getState().dismissSuggestion(key)
                setVisible((previous) =>
                  previous.filter((item) => suggestionKey(item) !== key)
                )
              }}
            />
          ))
        )}
      </div>
    </section>
  )
}
