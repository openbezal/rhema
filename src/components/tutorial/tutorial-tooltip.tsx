import type { TooltipRenderProps } from "react-joyride"

export function TutorialTooltip({
  index,
  step,
  size,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  tooltipProps,
}: TooltipRenderProps) {
  return (
    <div
      {...tooltipProps}
      className="z-[70] w-80 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg"
    >
      <div className="mb-3 text-sm">
        {typeof step.content === "string" ? step.content : step.content}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {index + 1} of {size}
        </span>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              {...backProps}
              className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
          )}
          <button
            {...skipProps}
            className="rounded px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
          <button
            {...primaryProps}
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          >
            {isLastStep ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  )
}
