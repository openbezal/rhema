import { invoke } from "@tauri-apps/api/core"

/** Webfonts bundled with the app (fontsource imports in index.css / broadcast-fonts.css). */
export const BUNDLED_FONTS = [
  "Geist Variable",
  "Source Serif 4 Variable",
  "Inter Variable",
  "Geist Mono",
]

/** Web-safe fallbacks shown when system enumeration is unavailable (web build, tests). */
const FALLBACK_FONTS = [
  "Georgia",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Courier New",
]

let systemFontsPromise: Promise<string[]> | null = null

/**
 * Font families installed on this machine, via the `list_system_fonts` Tauri
 * command. Memoized; resolves to a fallback list outside of Tauri.
 */
export function listSystemFonts(): Promise<string[]> {
  if (!systemFontsPromise) {
    systemFontsPromise = invoke<string[]>("list_system_fonts").catch(() => {
      systemFontsPromise = null
      return FALLBACK_FONTS
    })
  }
  return systemFontsPromise
}

/** Bundled fonts first, then system fonts (deduplicated, already sorted). */
export async function listAllFonts(): Promise<{
  bundled: string[]
  system: string[]
}> {
  const bundledSet = new Set(BUNDLED_FONTS)
  const system = (await listSystemFonts()).filter((f) => !bundledSet.has(f))
  return { bundled: BUNDLED_FONTS, system }
}
