import { expect, it } from "vitest"
import { BUILTIN_THEMES } from "./builtin-themes"
import type { Translation } from "@/types"
import { PortablePreferencesSchema } from "./session-archive-schema"
import {
  stagePreferencesRestore,
  resolvePreferencesRestore,
  restoreTranslationChoices,
} from "./preference-restore"

const translations: Translation[] = [
  {
    id: 7,
    abbreviation: "KJV",
    title: "King James",
    language: "en",
    is_downloaded: true,
    is_copyrighted: false,
  },
  {
    id: 10,
    abbreviation: "BIUO",
    title: "Igbo",
    language: "ig",
    is_downloaded: true,
    is_copyrighted: true,
  },
]
function preferences() {
  return {
    settings: {
      gain: 1.6,
      autoMode: false,
      confidenceThreshold: 0.85,
      cooldownMs: 2000,
      suggestionCapacity: 40,
      suggestionRetentionMs: 90000,
      sttProvider: "whisper",
    },
    primaryTranslationCode: "BIUO",
    secondaryTranslationCode: "KJV",
    followDetections: true,
    autoLive: false,
    customThemes: [
      {
        ...structuredClone(BUILTIN_THEMES[0]),
        id: "old-id",
        name: "Chineke Ọlọ́run",
        builtin: false,
      },
    ],
  }
}

it("stages detached portable data and new theme identities without changing the source or local themes", () => {
  const source = {
    ...preferences(),
    settings: { ...preferences().settings, deepgramApiKey: "FAKE-EXCLUDED" },
    outputs: ["machine-only"],
  }
  const old = structuredClone(source)
  const existing = [{ ...BUILTIN_THEMES[0], id: "import-collision" }]
  const candidates = ["collision", "unique"]
  const stage = stagePreferencesRestore(source, translations, existing, () =>
    candidates.shift()!
  )
  expect(stage.preferences.customThemes[0].id).toBe("import-unique")
  expect(stage.primaryCode).toBe("BIUO")
  expect(stage.secondaryCode).toBe("KJV")
  expect(JSON.stringify(stage)).not.toContain("FAKE-EXCLUDED")
  expect(JSON.stringify(stage)).not.toContain("machine-only")
  stage.preferences.customThemes[0].name = "edited review copy"
  expect(source).toEqual(old)
  expect(existing[0].id).toBe("import-collision")
})

it("requires explicit installed choices for missing primary and optional translations", () => {
  const source = {
    ...preferences(),
    primaryTranslationCode: "MISSING",
    secondaryTranslationCode: "OTHER",
  }
  const stage = stagePreferencesRestore(
    source,
    translations,
    [],
    () => "unique"
  )
  expect(stage.primaryCode).toBeNull()
  expect(stage.secondaryCode).toBeUndefined()
  expect(() =>
    resolvePreferencesRestore(stage, null, undefined, translations)
  ).toThrow("primary")
  expect(() =>
    resolvePreferencesRestore(stage, "BIUO", undefined, translations)
  ).toThrow("secondary")
  const mapped = resolvePreferencesRestore(stage, "BIUO", null, translations)
  expect(mapped.primaryTranslationCode).toBe("BIUO")
  expect(mapped.secondaryTranslationCode).toBeNull()
  expect(source.primaryTranslationCode).toBe("MISSING")
})

it("rejects duplicate-code catalogs, disappearing choices and a secondary equal to primary", () => {
  const stage = stagePreferencesRestore(
    preferences(),
    translations,
    [],
    () => "unique"
  )
  expect(() =>
    resolvePreferencesRestore(stage, "BIUO", "BIUO", translations)
  ).toThrow("different")
  expect(() =>
    resolvePreferencesRestore(stage, "BIUO", null, translations.slice(0, 1))
  ).toThrow("available")
  const duplicate = [...translations, { ...translations[1], id: 11 }]
  expect(
    restoreTranslationChoices(duplicate).map((item) => item.abbreviation)
  ).toEqual(["KJV"])
  expect(
    stagePreferencesRestore(preferences(), duplicate, [], () => "unique")
      .primaryCode
  ).toBeNull()
})

it("bounds imported theme counts and identity allocation and rejects malformed portable fields", () => {
  expect(() =>
    stagePreferencesRestore(
      preferences(),
      translations,
      Array.from({ length: 1000 }, () => ({
        ...BUILTIN_THEMES[0],
        builtin: false,
      })),
      () => "unique"
    )
  ).toThrow("1000")
  expect(() =>
    stagePreferencesRestore(
      preferences(),
      translations,
      [{ ...BUILTIN_THEMES[0], id: "import-collision" }],
      () => "collision"
    )
  ).toThrow("identity")
  expect(() =>
    stagePreferencesRestore(
      { ...preferences(), settings: { ...preferences().settings, gain: NaN } },
      translations,
      [],
      () => "unique"
    )
  ).toThrow()
})

it("keeps archival gain values readable but restores only the current 0–2 audio range", () => {
  const source = preferences()
  source.settings.gain = 2
  expect(
    stagePreferencesRestore(source, translations, [], () => "unique")
      .preferences.settings.gain
  ).toBe(2)
  source.settings.gain = 2.01
  expect(PortablePreferencesSchema.safeParse(source).success).toBe(true)
  expect(() =>
    stagePreferencesRestore(source, translations, [], () => "unique")
  ).toThrow("Input gain")
})
