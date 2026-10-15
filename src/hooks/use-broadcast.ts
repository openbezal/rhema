import { requestOnAir } from "@/lib/output-safety"
import { useBroadcastStore } from "@/stores/broadcast-store"
export { presentVerse, toVerseRenderData } from "@/lib/presentation-controller"

export const broadcastActions = {
  setLive: (live: boolean) => requestOnAir(live),
  getActiveTheme: () => {
    const s = useBroadcastStore.getState()
    return s.themes.find((t) => t.id === s.activeThemeId) ?? s.themes[0]
  },
}
