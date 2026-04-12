import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"
import { useSettingsStore } from "./settings-store"

interface TutorialState {
  isRunning: boolean
  startTutorial: () => void
  stopTutorial: () => void
}

export const useTutorialStore = create<TutorialState>((set) => ({
  isRunning: false,
  startTutorial: () => set({ isRunning: true }),
  stopTutorial: () => set({ isRunning: false }),
}))

/** Load onboardingComplete from disk into settings store. */
export async function hydrateOnboardingState(): Promise<void> {
  try {
    const store = await load("settings.json", { autoSave: false })
    const completed = await store.get<boolean>("onboardingComplete")
    if (completed) {
      useSettingsStore.getState().setOnboardingComplete(true)
    }
  } catch {
    console.warn("[tutorial] Failed to load persisted state, using defaults")
  }
}

/** Write onboardingComplete=true to both Zustand and disk. */
export async function persistOnboardingComplete(): Promise<void> {
  useSettingsStore.getState().setOnboardingComplete(true)
  try {
    const store = await load("settings.json", { autoSave: false })
    await store.set("onboardingComplete", true)
    await store.save()
  } catch {
    console.warn("[tutorial] Failed to persist onboarding state")
  }
}
