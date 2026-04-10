import type { BroadcastTheme } from "@/types"

const THEME_EXPORT_VERSION = 1

interface ThemeExportPayload {
  app: "rhema"
  version: number
  exportedAt: string
  themes: BroadcastTheme[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isThemeArray(value: unknown): value is BroadcastTheme[] {
  return Array.isArray(value) && value.every((item) => isObject(item))
}

function ensureUniqueThemeId(existingIds: Set<string>, preferredId: string) {
  let nextId = preferredId
  while (existingIds.has(nextId)) {
    nextId = crypto.randomUUID()
  }
  existingIds.add(nextId)
  return nextId
}

export function serializeThemes(themes: BroadcastTheme[]) {
  const payload: ThemeExportPayload = {
    app: "rhema",
    version: THEME_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    themes,
  }

  return JSON.stringify(payload, null, 2)
}

export function parseImportedThemes(fileContents: string) {
  const parsed = JSON.parse(fileContents) as unknown

  if (isThemeArray(parsed)) {
    return parsed
  }

  if (isObject(parsed) && isThemeArray(parsed.themes)) {
    return parsed.themes
  }

  throw new Error("That file does not contain any importable themes.")
}

export function sanitizeImportedThemes(
  importedThemes: BroadcastTheme[],
  existingThemes: BroadcastTheme[],
) {
  const existingIds = new Set(existingThemes.map((theme) => theme.id))

  return importedThemes.map((theme) => ({
    ...theme,
    id: ensureUniqueThemeId(existingIds, theme.id),
    builtin: false,
    createdAt: typeof theme.createdAt === "number" ? theme.createdAt : Date.now(),
    updatedAt: Date.now(),
  }))
}
