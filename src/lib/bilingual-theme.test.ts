import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ emit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
import { BUILTIN_THEMES } from "./builtin-themes"
import { normalizeTheme } from "./theme-migrations"
import { secondaryVerseStyle } from "./bilingual-theme"
import { themeImageUrls } from "./theme-image-cache"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { BroadcastTheme } from "@/types"
function custom(): BroadcastTheme {
  return {
    ...BUILTIN_THEMES[0],
    id: "bilingual-fixture",
    builtin: false,
    verseText: {
      ...BUILTIN_THEMES[0].verseText,
      fontSize: 32,
      shadow: { color: "#123456", blur: 4, x: 2, y: 3 },
    },
  }
}
beforeEach(() => {
  mocks.emit.mockClear()
  useBroadcastStore.setState({
    themes: [...BUILTIN_THEMES, custom()],
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
    selectedElement: null,
    editingThemeId: null,
    draftTheme: null,
    presentationRecovery: "ready",
    outputStatus: {},
    outputs: [
      {
        ...useBroadcastStore.getState().outputs[0],
        id: "main",
        themeId: "bilingual-fixture",
      },
    ],
  })
})
it("keeps old single-language themes unchanged and inherits primary style", () => {
  const old = custom(),
    normalized = normalizeTheme(old)
  expect(normalized.secondaryVerseText).toBeUndefined()
  expect(secondaryVerseStyle(normalized)).toEqual(normalized.verseText)
})
it("preserves inherited nested style values when editing just one secondary control", () => {
  const store = useBroadcastStore.getState()
  store.startEditing("bilingual-fixture")
  store.updateDraftNested("secondaryVerseText.shadow.x", 12)
  const draft = useBroadcastStore.getState().draftTheme!
  expect(secondaryVerseStyle(draft).shadow).toEqual({
    color: "#123456",
    blur: 4,
    x: 12,
    y: 3,
  })
  expect(draft.verseText.shadow?.x).toBe(2)
})
it("fills legacy secondary plate defaults and rejects only its invalid free box", () => {
  const theme = custom()
  const normalized = normalizeTheme({
    ...theme,
    secondaryVerseText: { surface: { enabled: true, color: "#987654" } },
    layout: {
      ...theme.layout,
      mode: "free",
      referenceBox: { x: 5, y: 5, width: 80, height: 10 },
      verseBox: { x: 5, y: 20, width: 80, height: 60 },
      secondaryBox: { x: 5, y: 60, width: -1, height: 10 },
    },
  } as BroadcastTheme)
  expect(normalized.secondaryVerseText?.surface?.padding).toBe(0)
  expect(normalized.layout.mode).toBe("free")
  expect(normalized.layout.secondaryBox).toBeUndefined()
})
it("preloads an image used only by the secondary plate", () => {
  const t = custom()
  t.secondaryVerseText = {
    surface: {
      enabled: true,
      color: "#000",
      opacity: 1,
      borderRadius: 0,
      padding: 8,
      image: {
        url: "data:image/png;base64,secondary",
        fit: "cover",
        blur: 0,
        brightness: 100,
        tint: null,
      },
    },
  }
  expect(themeImageUrls(t)).toContain("data:image/png;base64,secondary")
})
it("saves and discards secondary edits independently while live is off", () => {
  const store = useBroadcastStore.getState()
  store.startEditing("bilingual-fixture")
  store.updateDraftNested("secondaryVerseText.fontSize", 48)
  store.saveDraft()
  const saved = useBroadcastStore
    .getState()
    .themes.find((theme) => theme.id === "bilingual-fixture")!
  expect(saved.verseText.fontSize).toBe(32)
  expect(saved.secondaryVerseText?.fontSize).toBe(48)
  store.updateDraftNested("secondaryVerseText.fontSize", 72)
  store.discardDraft()
  expect(
    useBroadcastStore.getState().draftTheme?.secondaryVerseText?.fontSize
  ).toBe(48)
  expect(
    normalizeTheme(JSON.parse(JSON.stringify(saved))).secondaryVerseText
      ?.fontSize
  ).toBe(48)
  expect(useBroadcastStore.getState()).toMatchObject({
    isLive: false,
    liveVerse: null,
  })
})
it("keeps an inherited primary plate after normalizing a typography-only override", () => {
  const t = custom()
  t.verseText.surface = {
    enabled: true,
    color: "#123456",
    opacity: 1,
    borderRadius: 0,
    padding: 8,
    image: null,
  }
  t.secondaryVerseText = { fontSize: 48 }
  const normalized = normalizeTheme(t)
  expect(secondaryVerseStyle(normalized).surface).toEqual(t.verseText.surface)
})

it.each(["discard", "close", "switch"])(
  "restores the saved output theme after %s without retaining a discarded secondary style",
  (action) => {
    const store = useBroadcastStore.getState()
    store.saveTheme({ ...custom(), id: "other-fixture" })
    store.startEditing("bilingual-fixture")
    store.updateDraftNested("secondaryVerseText.fontSize", 80)
    expect(
      mocks.emit.mock.calls.at(-1)?.[2].theme.secondaryVerseText.fontSize
    ).toBe(80)
    if (action === "discard") store.discardDraft()
    else if (action === "close") store.setDesignerOpen(false)
    else store.startEditing("other-fixture")
    expect(mocks.emit.mock.calls.at(-1)?.[2].theme.id).toBe("bilingual-fixture")
    expect(
      mocks.emit.mock.calls.at(-1)?.[2].theme.secondaryVerseText
    ).toBeUndefined()
    expect(useBroadcastStore.getState()).toMatchObject({
      isLive: false,
      liveVerse: null,
    })
  }
)
