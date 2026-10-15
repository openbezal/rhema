import { useEffect } from "react"
import { SparklesIcon, ChevronLeftIcon } from "lucide-react"
import type { TooltipRenderProps } from "react-joyride"

export function TutorialTooltip({
  index,
  step,
  size,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  controls,
  tooltipProps,
}: TooltipRenderProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault()
        if (isLastStep) {
          controls.skip("button_skip")
        } else {
          controls.next()
        }
      } else if (e.key === "ArrowLeft" && index > 0) {
        e.preventDefault()
        controls.prev()
      } else if (e.key === "Escape") {
        e.preventDefault()
        controls.skip("button_close")
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [controls, index, isLastStep])

  return (
    <div
      {...tooltipProps}
      className="z-[70] w-[340px] overflow-hidden rounded-xl bg-card shadow-2xl shadow-black/25"
    >
      <div className="flex items-center gap-2.5 border-b border-border/40 px-4 pt-4 pb-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/15">
          <SparklesIcon className="size-3.5 text-primary" />
        </div>
        <h3 className="text-sm leading-tight font-semibold tracking-tight text-foreground">
          {step.title ?? `Step ${index + 1}`}
        </h3>
      </div>

      <div className="px-4 py-3">
        <p className="max-w-[40ch] text-[0.8125rem] leading-[1.6] text-muted-foreground">
          {step.content}
        </p>
      </div>

      <div className="space-y-2.5 border-t border-border/40 px-4 py-3">
        <div className="flex items-center gap-1">
          {Array.from({ length: size }, (_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all duration-200 ${
                i === index
                  ? "w-3.5 bg-primary"
                  : i < index
                    ? "w-1.5 bg-primary/40"
                    : "w-1.5 bg-muted-foreground/20"
              }`}
            />
          ))}
          <span className="ml-1 text-[0.6875rem] text-muted-foreground/50 tabular-nums">
            {index + 1}/{size}
          </span>
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            {...skipProps}
            className="mr-auto rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Skip
          </button>
          {index > 0 ? (
            <button
              {...backProps}
              className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeftIcon className="size-3" />
              Back
            </button>
          ) : null}
          <button
            {...primaryProps}
            className="rounded-md bg-primary px-3.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {isLastStep ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
