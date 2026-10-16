import { effectiveBroadcastTheme } from "@/lib/effective-broadcast-theme"
import { requestOnAir } from "@/lib/output-safety"
import { useBroadcastStore } from "@/stores/broadcast-store"
export { presentVerse, toVerseRenderData } from "@/lib/presentation-controller"

export const broadcastActions = {
  setLive: (live: boolean) => requestOnAir(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return effectiveBroadcastTheme(s, s.activeThemeId)
  },
}

export const useActiveBroadcastTheme = () => useBroadcastStore((state) => effectiveBroadcastTheme(state, state.activeThemeId))
