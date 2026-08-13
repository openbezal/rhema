import { useBroadcastStore, type NewThemeLayoutKind } from "@/stores/broadcast-store"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

function LayoutOption({
  title,
  description,
  preview,
  onSelect,
}: {
  title: string
  description: string
  preview: React.ReactNode
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left",
        "transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
        {preview}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </button>
  )
}

export function NewThemeDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const handleCreate = (kind: NewThemeLayoutKind) => {
    useBroadcastStore.getState().createNewTheme(kind)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Theme</DialogTitle>
          <DialogDescription>Choose a starting layout.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <LayoutOption
            title="Full Screen"
            description="Solid background filling the whole frame"
            onSelect={() => handleCreate("fullscreen")}
            preview={
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-zinc-900">
                <div className="h-1.5 w-1/2 rounded-sm bg-zinc-500" />
                <div className="h-1.5 w-2/3 rounded-sm bg-zinc-600" />
                <div className="h-1.5 w-3/5 rounded-sm bg-zinc-600" />
              </div>
            }
          />
          <LayoutOption
            title="Lower Thirds"
            description="Transparent overlay with a text band at the bottom"
            onSelect={() => handleCreate("lower-thirds")}
            preview={
              <div className="absolute inset-0 bg-[repeating-conic-gradient(theme(colors.zinc.700)_0%_25%,theme(colors.zinc.800)_0%_50%)] bg-[length:12px_12px]">
                <div className="absolute inset-x-2 bottom-1.5 flex h-1/3 flex-col items-center justify-center gap-1 rounded-sm bg-zinc-950/80">
                  <div className="h-1 w-2/3 rounded-sm bg-zinc-400" />
                  <div className="h-1 w-1/3 rounded-sm bg-amber-400/80" />
                </div>
              </div>
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
