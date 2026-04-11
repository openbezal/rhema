import type { BroadcastTheme } from "@/types"

interface ResolveRenderableThemeOptions {
  themes: BroadcastTheme[]
  themeId: string
  draftTheme: BroadcastTheme | null
  editingThemeId: string | null
}

export function resolveRenderableTheme({
  themes,
  themeId,
  draftTheme,
  editingThemeId,
}: ResolveRenderableThemeOptions) {
  if (draftTheme && editingThemeId === themeId) {
    return draftTheme
  }

  return themes.find((theme) => theme.id === themeId) ?? themes[0]
}
