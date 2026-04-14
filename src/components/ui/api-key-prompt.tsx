import { openSettings } from "@/lib/settings-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ApiKeyPromptProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: string
  description?: string
}

export function ApiKeyPrompt({
  open,
  onOpenChange,
  service,
  description,
}: ApiKeyPromptProps) {
  const serviceLabel =
    service === "Deepgram" ? (
      <>
        <span className="text-chart-1">D</span>
        <span className="text-chart-2">eep</span>
        <span className="text-chart-3">gram</span>
      </>
    ) : (
      service
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-white/12 bg-linear-to-b from-card to-card/95 sm:max-w-[420px]"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-linear-to-br from-chart-1 via-chart-2 to-chart-3 p-px shadow-[0_0_30px_color-mix(in_oklab,var(--color-chart-2)_28%,transparent)]">
            <div className="flex size-full items-center justify-center rounded-full bg-card">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="url(#api-key-gradient)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6"
            >
              <defs>
                <linearGradient id="api-key-gradient" x1="0" y1="0" x2="24" y2="24">
                  <stop offset="0%" stopColor="var(--color-chart-1)" />
                  <stop offset="55%" stopColor="var(--color-chart-2)" />
                  <stop offset="100%" stopColor="var(--color-chart-3)" />
                </linearGradient>
              </defs>
              <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
          </div>
          </div>
          <DialogTitle className="text-center">
            <span className="font-semibold">{serviceLabel}</span>{" "}
            <span className="text-foreground">API key required</span>
          </DialogTitle>
          <DialogDescription className="text-center">
            {description ??
              `To use this feature, add your ${service} API key in settings.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              onOpenChange(false)
              window.setTimeout(() => {
                openSettings("speech")
              }, 120)
            }}
          >
            Open settings
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
