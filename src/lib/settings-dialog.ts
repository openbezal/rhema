import { create } from "zustand"

type SettingsSection = "audio" | "speech" | "bible" | "display" | "api-keys" | "help"

interface SettingsDialogState {
  isOpen: boolean
  activeSection: SettingsSection
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  setActiveSection: (section: SettingsSection) => void
}

const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  isOpen: false,
  activeSection: "audio",
  openSettings: (section) =>
    set((state) => ({
      isOpen: true,
      activeSection: section ?? state.activeSection,
    })),
  closeSettings: () => set({ isOpen: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}))

export function openSettings(section?: SettingsSection) {
  useSettingsDialogStore.getState().openSettings(section)
}

export { useSettingsDialogStore }
export type { SettingsSection }
