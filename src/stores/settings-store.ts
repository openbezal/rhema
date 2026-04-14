import { create } from "zustand"
import { load } from "@tauri-apps/plugin-store"

type SttProvider = "deepgram" | "whisper"

interface SettingsState {
  deepgramApiKey: string | null
  openaiApiKey: string | null
  claudeApiKey: string | null
  activeTranslationId: number
  audioDeviceId: string | null
  gain: number
  autoMode: boolean
  confidenceThreshold: number
  cooldownMs: number
  onboardingComplete: boolean
  sttProvider: SttProvider
  setDeepgramApiKey: (key: string | null) => void
  setOpenaiApiKey: (key: string | null) => void
  setClaudeApiKey: (key: string | null) => void
  setActiveTranslationId: (id: number) => void
  setAudioDeviceId: (id: string | null) => void
  setGain: (gain: number) => void
  setAutoMode: (auto: boolean) => void
  setConfidenceThreshold: (threshold: number) => void
  setCooldownMs: (ms: number) => void
  setOnboardingComplete: (complete: boolean) => void
  setSttProvider: (provider: SttProvider) => void
}

const PERSISTED_KEYS: (keyof SettingsState)[] = [
  "deepgramApiKey",
  "openaiApiKey",
  "claudeApiKey",
  "activeTranslationId",
  "audioDeviceId",
  "gain",
  "autoMode",
  "confidenceThreshold",
  "cooldownMs",
  "onboardingComplete",
  "sttProvider",
]

async function persistSetting(key: string, value: unknown) {
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} })
    await store.set(key, value)
    await store.save()
  } catch {
    console.warn(`[settings] Failed to persist ${key}`)
  }
}

export async function hydrateSettingsStore() {
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} })
    const updates: Partial<SettingsState> = {}

    for (const key of PERSISTED_KEYS) {
      const value = await store.get<unknown>(key)
      if (value !== null && value !== undefined) {
        // @ts-expect-error dynamic key assignment
        updates[key] = value
      }
    }

    useSettingsStore.setState(updates)
    console.log("[settings] Hydrated from disk", updates)
  } catch {
    console.warn("[settings] Failed to hydrate settings, using defaults")
  }
}

function makePersisted<T>(key: string, setter: (val: T) => void) {
  return (val: T) => {
    setter(val)
    persistSetting(key, val)
  }
}

export const useSettingsStore = create<SettingsState>((set) => ({
  deepgramApiKey: null,
  openaiApiKey: null,
  claudeApiKey: null,
  activeTranslationId: 1,
  audioDeviceId: null,
  gain: 1.0,
  autoMode: false,
  confidenceThreshold: 0.8,
  cooldownMs: 2500,
  onboardingComplete: false,
  sttProvider: "deepgram",

  setDeepgramApiKey: makePersisted("deepgramApiKey", (deepgramApiKey) => set({ deepgramApiKey })),
  setOpenaiApiKey: makePersisted("openaiApiKey", (openaiApiKey) => set({ openaiApiKey })),
  setClaudeApiKey: makePersisted("claudeApiKey", (claudeApiKey) => set({ claudeApiKey })),
  setActiveTranslationId: makePersisted("activeTranslationId", (activeTranslationId) => set({ activeTranslationId })),
  setAudioDeviceId: makePersisted("audioDeviceId", (audioDeviceId) => set({ audioDeviceId })),
  setGain: makePersisted("gain", (gain) => set({ gain })),
  setAutoMode: makePersisted("autoMode", (autoMode) => set({ autoMode })),
  setConfidenceThreshold: makePersisted("confidenceThreshold", (confidenceThreshold) => set({ confidenceThreshold })),
  setCooldownMs: makePersisted("cooldownMs", (cooldownMs) => set({ cooldownMs })),
  setOnboardingComplete: makePersisted("onboardingComplete", (onboardingComplete) => set({ onboardingComplete })),
  setSttProvider: makePersisted("sttProvider", (sttProvider) => set({ sttProvider })),
}))