import { useState, useEffect, useCallback } from "react"
import { Joyride, STATUS, type EventData } from "react-joyride"
import { useSettingsStore } from "@/stores"
import { useTutorialStore } from "@/stores/tutorial-store"
import {
  hydrateOnboardingState,
  persistOnboardingComplete,
} from "@/stores/tutorial-store"
import { TUTORIAL_STEPS } from "./tutorial-steps"
import { TutorialTooltip } from "./tutorial-tooltip"

export function TutorialOverlay() {
  const [isHydrated, setIsHydrated] = useState(false)
  const isRunning = useTutorialStore((s) => s.isRunning)
  const onboardingComplete = useSettingsStore((s) => s.onboardingComplete)

  useEffect(() => {
    hydrateOnboardingState().then(() => {
      setIsHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (isHydrated && !onboardingComplete) {
      const timer = setTimeout(() => {
        useTutorialStore.getState().startTutorial()
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isHydrated, onboardingComplete])

  const handleEvent = useCallback((data: EventData) => {
    const { status } = data
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      useTutorialStore.getState().stopTutorial()
      persistOnboardingComplete()
    }
  }, [])

  if (!isHydrated) return null

  return (
    <Joyride
      steps={TUTORIAL_STEPS}
      run={isRunning}
      continuous
      buttons={["back", "primary", "skip"]}
      skipScroll
      tooltipComponent={TutorialTooltip}
      onEvent={handleEvent}
      zIndex={60}
      overlayColor="rgba(0, 0, 0, 0.5)"
    />
  )
}
