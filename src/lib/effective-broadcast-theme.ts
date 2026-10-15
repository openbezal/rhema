import type { BroadcastTheme } from "@/types"
interface ThemeState {
  themes: BroadcastTheme[]
  editingThemeId: string | null
  draftTheme: BroadcastTheme | null
}
/** All preview/output surfaces use the same current draft-or-saved theme. */
export function effectiveBroadcastTheme(
  state: ThemeState,
  themeId: string
): BroadcastTheme {
  return (
    (state.editingThemeId === themeId ? state.draftTheme : null) ??
    state.themes.find((theme) => theme.id === themeId) ??
    state.themes[0]
  )
}
