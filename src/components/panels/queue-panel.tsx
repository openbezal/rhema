import { PanelHeader } from "@/components/ui/panel-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  PlayIcon,
  XIcon,
  GripVerticalIcon,
} from "lucide-react"
import { useQueueStore, useBroadcastStore, useBibleStore } from "@/stores"
import { toVerseRenderData } from "@/hooks/use-broadcast"
import { bibleActions } from "@/hooks/use-bible"
import type { QueueItem } from "@/types"

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
  const handlePresent = () => {
    useQueueStore.getState().setActive(index)
    bibleActions.selectVerse(item.verse)
    const translation = useBibleStore.getState().translations
      .find(t => t.id === useBibleStore.getState().activeTranslationId)?.abbreviation ?? "KJV"
    useBroadcastStore.getState().setLiveVerse(toVerseRenderData(item.verse, translation))
  }

  const handleRemove = () => {
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
      className={cn(
        "group flex h-10 items-center gap-2 rounded-md px-2.5 transition-colors",
        isHighlighted
          ? "animate-pulse border border-amber-500/40 bg-amber-500/15"
          : isActive
            ? "border border-primary/30 bg-primary/10"
            : "hover:bg-muted/50"
      )}
    >
      <GripVerticalIcon
        className="size-3 shrink-0 text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100"
      />

      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {item.reference}
      </span>

      {sourceBadge}

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-xs" onClick={handlePresent}>
          <PlayIcon className="size-2.5" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={handleRemove}>
          <XIcon className="size-2.5" />
        </Button>
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
