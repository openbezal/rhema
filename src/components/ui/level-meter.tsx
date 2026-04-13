import * as React from "react"

import { cn } from "@/lib/utils"

const BAR_COLORS = [
  "bg-confidence-high",
  "bg-confidence-high",
  "bg-confidence-high",
  "bg-confidence-high",
  "bg-confidence-mid",
  "bg-confidence-low",
] as const

function LevelMeter({
  className,
  level,
  bars = 4,
  ...props
}: React.ComponentProps<"div"> & {
  level: number
  bars?: number
}) {
  const scaled = Math.min(level / 0.25, 1)
  const curved = Math.pow(scaled, 0.4)
  const litCount = Math.round(curved * bars)

  return (
    <div
      data-slot="level-meter"
      className={cn("flex items-end gap-px", className)}
      role="meter"
      aria-valuenow={Math.round(curved * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Microphone level"
      {...props}
    >
      {Array.from({ length: bars }, (_, i) => {
        const active = i < litCount
        const color = BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]

        return (
          <span
            key={i}
            className={cn(
              "w-0.75 rounded-sm transition-[background-color] duration-75",
              active ? color : "bg-muted-foreground/15"
            )}
            style={{ height: `${6 + i * 2.5}px` }}
          />
        )
      })}
    </div>
  )
}

export { LevelMeter }
