// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useProfileStatusStore } from "@/lib/profile-status"
import { useSettingsStore } from "@/stores/settings-store"
import { useTutorialStore } from "@/stores/tutorial-store"
import { ProfileWarningBanner } from "./profile-warning-banner"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { TranslationSelectionDialog } from "@/components/translation-selection-dialog"
import { useBibleStore } from "@/stores/bible-store"

vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark" }),
}))
vi.mock("react-joyride", () => ({
  STATUS: { FINISHED: "finished", SKIPPED: "skipped" },
  Joyride: ({ run }: { run: boolean }) => (
    <div data-tutorial-running={String(run)} />
  ),
}))
vi.mock("@/stores/tutorial-store", async (original) => ({
  ...(await original<typeof import("@/stores/tutorial-store")>()),
  hydrateOnboardingState: vi.fn().mockResolvedValue(undefined),
}))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("requestAnimationFrame", vi.fn())
  vi.useFakeTimers()
  useProfileStatusStore.setState({ readFailed: false })
  useSettingsStore.setState({ onboardingComplete: false })
  useTutorialStore.getState().stopTutorial()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("shows a generic warning and suppresses first-run onboarding after a profile read failure", async () => {
  useProfileStatusStore.setState({ readFailed: true })
  await act(async () => {
    root.render(
      <>
        <ProfileWarningBanner />
        <TutorialOverlay />
      </>
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Saved preferences could not be loaded"
  )
  expect(useTutorialStore.getState().isRunning).toBe(false)
  expect(host.querySelector("[data-tutorial-running] ")).toBeNull()
})

it("keeps the warning collapsed and starts onboarding for a healthy fresh profile", async () => {
  await act(async () => {
    root.render(
      <>
        <ProfileWarningBanner />
        <TutorialOverlay />
      </>
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(useTutorialStore.getState().isRunning).toBe(true)
  expect(host.querySelector('[data-tutorial-running="true"]')).not.toBeNull()
})

it("explains the read failure inside the blocking Bible confirmation dialog", async () => {
  useProfileStatusStore.setState({ readFailed: true })
  useBibleStore.setState({
    translationSelectionStatus: "needs_confirmation",
    translations: [],
  })
  await act(async () => {
    root.render(<TranslationSelectionDialog />)
  })
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.textContent).toContain("Saved preferences could not be loaded")
  expect(dialog?.textContent).toContain("for this session")
  expect(dialog?.textContent).not.toContain("will be saved")
})
