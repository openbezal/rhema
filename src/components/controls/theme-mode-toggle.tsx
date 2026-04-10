import { useCallback, useEffect, useState } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

type DocumentWithTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>
  }
}

export function ThemeModeToggle({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { resolvedTheme, setTheme } = useTheme()
  const [checked, setChecked] = useState(false)

  useEffect(() => setChecked(resolvedTheme === "dark"), [resolvedTheme])

  const handleCheckedChange = useCallback(
    (isChecked: boolean) => {
      setChecked(isChecked)
      const nextTheme = isChecked ? "dark" : "light"
      const transitionDocument = document as DocumentWithTransition

      if (!transitionDocument.startViewTransition) {
        setTheme(nextTheme)
        return
      }

      transitionDocument.startViewTransition(() => {
        setTheme(nextTheme)
      })
    },
    [setTheme],
  )

  return (
    <div
      className={cn(
        "relative flex items-center justify-center h-7 w-14",
        className,
      )}
      {...props}
    >
      <Switch
        checked={checked}
        onCheckedChange={handleCheckedChange}
        className={cn(
          "absolute inset-0 h-full w-full rounded-full bg-input/50 transition-colors",
          "[&>span]:h-[22px] [&>span]:w-[22px] [&>span]:rounded-full [&>span]:bg-background [&>span]:shadow [&>span]:z-10",
          "data-[state=unchecked]:[&>span]:translate-x-0.5",
          "data-[state=checked]:[&>span]:translate-x-[30px]",
        )}
      />

      <span className="pointer-events-none absolute left-1.5 inset-y-0 z-0 flex items-center justify-center">
        <SunIcon
          size={12}
          className={cn(
            "transition-all duration-200 ease-out",
            checked ? "text-muted-foreground/70" : "text-foreground scale-110",
          )}
        />
      </span>

      <span className="pointer-events-none absolute right-1.5 inset-y-0 z-0 flex items-center justify-center">
        <MoonIcon
          size={12}
          className={cn(
            "transition-all duration-200 ease-out",
            checked ? "text-foreground scale-110" : "text-muted-foreground/70",
          )}
        />
      </span>
    </div>
  )
}
