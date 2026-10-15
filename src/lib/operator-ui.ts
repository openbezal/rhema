import { create } from "zustand"
/** Ephemeral UI requests; never persisted as service/operator state. */
export const useOperatorUiStore = create<{
  commandsOpen: boolean
  shortcutsOpen: boolean
  searchFocusRevision: number
}>(() => ({
  commandsOpen: false,
  shortcutsOpen: false,
  searchFocusRevision: 0,
}))
