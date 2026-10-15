import type { Translation } from "@/types"

export type TranslationSelectionStatus = "loading" | "ready" | "needs_confirmation" | "unavailable"
export interface SavedTranslationSelection {
  version: 1
  code: string
  /** Runtime mapping at save time: provenance, never the restored identity. */
  catalog: Record<string, number>
}

export function translationCode(translation: Translation): string {
  return translation.abbreviation.trim().toUpperCase()
}

export function resolveTranslationSelection(
  translations: Translation[], saved: unknown, legacyId: unknown,
): { translation: Translation | null; status: TranslationSelectionStatus } {
  const installed = translations.filter((item) => item.is_downloaded)
  if (installed.length === 0) return { translation: null, status: "unavailable" }
  const fallback = installed.find((item) => translationCode(item) === "KJV") ?? installed[0]
  if (typeof saved === "object" && saved !== null && "version" in saved && saved.version === 1 &&
      "code" in saved && typeof saved.code === "string" && saved.code.trim()) {
    const code = saved.code.trim().toUpperCase()
    const matches = installed.filter((item) => translationCode(item) === code)
    if (matches.length === 1) return { translation: matches[0], status: "ready" }
  }
  if (saved != null || legacyId != null || translationCode(fallback) !== "KJV") {
    return { translation: fallback, status: "needs_confirmation" }
  }
  return { translation: fallback, status: "ready" }
}

export function saveTranslationSelection(code: string, translations: Translation[]): SavedTranslationSelection {
  return { version: 1, code, catalog: Object.fromEntries(translations.map((item) => [translationCode(item), item.id])) }
}
