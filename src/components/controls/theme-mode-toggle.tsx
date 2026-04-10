import { useId, useRef, useState } from "react"
import { useTheme } from "@/components/theme-provider"

type DocumentWithTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>
  }
}

/**
 * Two-phase toggle:
 * 1. Checkbox flips immediately → SVG stroke-draw animation plays on the live DOM
 * 2. After a delay (letting the stroke finish), the View Transition fires to
 *    dissolve the page into the new theme
 *
 * This avoids the view-transition snapshot hiding the live CSS animation.
 */
export function ThemeModeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const id = useId()
  const pendingRef = useRef(false)

  // Local checked state decoupled from theme so the checkbox
  // can flip before the actual theme changes
  const [localChecked, setLocalChecked] = useState(resolvedTheme === "dark")

  const isDark = resolvedTheme === "dark"

  const handleChange = () => {
    if (pendingRef.current) return
    pendingRef.current = true

    const nextTheme = isDark ? "light" : "dark"
    const transitionDocument = document as DocumentWithTransition

    // Phase 1: flip the checkbox immediately so the SVG animates
    setLocalChecked(!localChecked)

    // Phase 2: after the stroke animation has mostly played (500ms of 800ms),
    // fire the view transition to change the actual theme
    const delay = transitionDocument.startViewTransition ? 350 : 0

    setTimeout(() => {
      if (!transitionDocument.startViewTransition) {
        setTheme(nextTheme)
        pendingRef.current = false
        return
      }

      const transition = transitionDocument.startViewTransition(() => {
        setTheme(nextTheme)
      })
      transition.finished.then(() => {
        pendingRef.current = false
      })
    }, delay)
  }

  return (
    <div className="theme-svg-switch-wrap">
      <input
        id={id}
        className="theme-svg-switch-check"
        type="checkbox"
        checked={localChecked}
        onChange={handleChange}
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      />
      <label
        className="theme-svg-switch"
        htmlFor={id}
        title={`Switch to ${isDark ? "light" : "dark"} mode`}
      >
        <span className="sr-only">Toggle theme</span>
        <svg viewBox="0 0 212.4992 84.4688" overflow="visible">
          <path
            pathLength={360}
            fill="none"
            stroke="currentColor"
            d="M 42.2496 0 A 42.24 42.24 90 0 0 0 42.2496 A 42.24 42.24 90 0 0 42.2496 84.4688 A 42.24 42.24 90 0 0 84.4992 42.2496 A 42.24 42.24 90 0 0 42.2496 0 A 42.24 42.24 90 0 0 0 42.2496 A 42.24 42.24 90 0 0 42.2496 84.4688 L 170.2496 84.4688 A 42.24 42.24 90 0 0 212.4992 42.2496 A 42.24 42.24 90 0 0 170.2496 0 A 42.24 42.24 90 0 0 128 42.2496 A 42.24 42.24 90 0 0 170.2496 84.4688 A 42.24 42.24 90 0 0 212.4992 42.2496 A 42.24 42.24 90 0 0 170.2496 0 L 42.2496 0"
          />
        </svg>
      </label>
    </div>
  )
}
