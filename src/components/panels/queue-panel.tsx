import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlayIcon, XIcon } from "lucide-react"
import { useQueueStore } from "@/stores"
import { operatorActions } from "@/lib/operator-actions"
import type { QueueItem } from "@/types"
import { useDisplayVerseReference } from "@/hooks/use-book-display-names"

function QueueItemRow({
  item,
  index,
  isActive,
  isHighlighted,
}: {
  item: QueueItem
  index: number
  isActive: boolean
  isHighlighted: boolean
}) {
  const displayReference = useDisplayVerseReference()
  const reference = displayReference(
    item.verse,
    item.translation_code,
    item.is_chapter_only,
    item.reference
  )
  const handlePresent = () => {
    void operatorActions.presentQueueItem(index)
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    useQueueStore.getState().removeItem(item.id)
  }

  const sourceBadge =
    item.source === "manual" ? (
      <Badge variant="outline" className="shrink-0 text-[0.5rem]">
        Manual
      </Badge>
    ) : (
      <Badge
        variant="default"
        className="shrink-0 bg-ai-direct/15 text-[0.5rem] text-ai-direct hover:bg-ai-direct/15"
      >
        AI
      </Badge>
    )

  return (
    <div
      data-queue-idx={index}
      data-operator-item={item.id}
      tabIndex={0}
      aria-label={reference}
      onClick={handlePresent}
      className={cn(
        "group flex cursor-pointer flex-col gap-1 rounded-md px-2.5 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        isHighlighted
          ? "animate-pulse border border-amber-500/40 bg-amber-500/15"
          : isActive
            ? "border border-primary/30 bg-primary/10"
            : "hover:bg-muted/50"
      )}
    >
      <span
        title={reference}
        className="w-full truncate text-sm font-medium text-foreground"
      >
        {reference}
      </span>

      <div className="flex w-full items-center gap-2">
        {item.translation_code && (
          <span className="text-xs text-muted-foreground">
            {item.translation_code}
          </span>
        )}
        {sourceBadge}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Present ${reference}`}
            data-operator-present
            onClick={(e) => {
              e.stopPropagation()
              handlePresent()
            }}
          >
            <PlayIcon className="size-2.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            data-operator-remove
            aria-label={`Remove ${reference} from Queue`}
            onClick={handleRemove}
          >
            <XIcon className="size-2.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function QueuePanel() {
  const items = useQueueStore((s) => s.items)
  const activeIndex = useQueueStore((s) => s.activeIndex)
  const highlightedId = useQueueStore((s) => s.highlightedId)

  return (
    <div
      data-slot="queue-panel"
      data-operator-list="queue"
      tabIndex={-1}
      aria-label="Queue panel"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <PanelHeader title="Queue">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{items.length}</Badge>
          <button
            onClick={() => useQueueStore.getState().clearQueue()}
            className="text-[0.625rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-1.5">
          {items.length === 0 && (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Verses will appear here when detected or queued
            </p>
          )}
          {items.map((item, idx) => (
            <QueueItemRow
              key={item.id}
              item={item}
              index={idx}
              isActive={idx === activeIndex}
              isHighlighted={item.id === highlightedId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
