import type { z } from "zod"
import type { BroadcastTheme, Translation } from "@/types"
import { PortablePreferencesSchema } from "./session-archive-schema"
import { translationCode } from "./translation-selection"

type PortablePreferences = z.infer<typeof PortablePreferencesSchema>
const RestoreSettingsSchema = PortablePreferencesSchema.shape.settings.extend({
  gain: PortablePreferencesSchema.shape.settings.shape.gain.max(
    2,
    "Input gain must be between 0× and 2×."
  ),
})
export const ResolvedPreferencesRestoreSchema =
  PortablePreferencesSchema.extend({
    settings: RestoreSettingsSchema,
    primaryTranslationCode:
      PortablePreferencesSchema.shape.primaryTranslationCode.unwrap(),
  })
export interface StagedPreferencesRestore {
  preferences: PortablePreferences
  primaryCode: string | null
  /** Undefined requires an explicit choice; null means the operator chose None. */
  secondaryCode: string | null | undefined
}
export type ResolvedPreferencesRestore = z.infer<
  typeof ResolvedPreferencesRestoreSchema
>

export function restoreTranslationChoices(
  translations: Translation[]
): Translation[] {
  const installed = translations.filter(
    (item) =>
      item.is_downloaded &&
      PortablePreferencesSchema.shape.primaryTranslationCode
        .unwrap()
        .safeParse(translationCode(item)).success
  )
  return installed.filter(
    (item) =>
      installed.filter(
        (other) => translationCode(other) === translationCode(item)
      ).length === 1
  )
}

export function stagePreferencesRestore(
  source: unknown,
  translations: Translation[],
  currentThemes: BroadcastTheme[],
  createId: () => string = () => crypto.randomUUID()
): StagedPreferencesRestore {
  const preferences = PortablePreferencesSchema.parse(source)
  const settings = RestoreSettingsSchema.safeParse(preferences.settings)
  if (!settings.success)
    throw new Error(
      settings.error.issues[0]?.message ?? "Unsupported input gain"
    )
  preferences.settings = settings.data
  if (
    preferences.customThemes.length +
      currentThemes.filter((theme) => !theme.builtin).length >
    1000
  )
    throw new Error("Keep at most 1000 custom themes after importing")
  const ids = new Set(currentThemes.map((theme) => theme.id))
  for (const theme of preferences.customThemes) {
    let candidate: string | null = null
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = `import-${createId()}`
      if (!ids.has(id)) {
        candidate = id
        break
      }
    }
    if (!candidate)
      throw new Error("Could not allocate a unique imported theme identity")
    ids.add(candidate)
    theme.id = candidate
  }
  const codes = new Set(
    restoreTranslationChoices(translations).map(translationCode)
  )
  return {
    preferences,
    primaryCode:
      preferences.primaryTranslationCode &&
      codes.has(preferences.primaryTranslationCode)
        ? preferences.primaryTranslationCode
        : null,
    secondaryCode:
      preferences.secondaryTranslationCode === null
        ? null
        : codes.has(preferences.secondaryTranslationCode)
          ? preferences.secondaryTranslationCode
          : undefined,
  }
}

export function resolvePreferencesRestore(
  stage: StagedPreferencesRestore,
  primaryCode: string | null,
  secondaryCode: string | null | undefined,
  translations: Translation[]
): ResolvedPreferencesRestore {
  if (!primaryCode) throw new Error("Choose an installed primary translation")
  if (secondaryCode === undefined)
    throw new Error("Choose an installed secondary translation or None")
  const codes = new Set(
    restoreTranslationChoices(translations).map(translationCode)
  )
  if (
    !codes.has(primaryCode) ||
    (secondaryCode !== null && !codes.has(secondaryCode))
  )
    throw new Error(
      "A selected translation is no longer available; review the choices again"
    )
  if (secondaryCode === primaryCode)
    throw new Error("Choose a different secondary translation or None")
  return {
    ...ResolvedPreferencesRestoreSchema.parse({
      ...stage.preferences,
      primaryTranslationCode: primaryCode,
      secondaryTranslationCode: secondaryCode,
    }),
    primaryTranslationCode: primaryCode,
    secondaryTranslationCode: secondaryCode,
  }
}
