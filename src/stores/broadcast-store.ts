import { create } from "zustand"
import { emitTo } from "@tauri-apps/api/event"
import type { BroadcastTheme, VerseRenderData } from "@/types"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { resolveRenderableTheme } from "@/lib/renderable-theme"
import { sanitizeImportedThemes } from "@/lib/theme-transfer"

type SelectedElement = "verse" | "reference" | null

interface BroadcastState {
  themes: BroadcastTheme[]
  activeThemeId: string
  altActiveThemeId: string
  isLive: boolean
  liveVerse: VerseRenderData | null

  // Designer state
  isDesignerOpen: boolean
  editingThemeId: string | null
  draftTheme: BroadcastTheme | null
  selectedElement: SelectedElement

  // Theme management
  loadThemes: () => void
  saveTheme: (theme: BroadcastTheme) => void
  renameTheme: (id: string, name: string) => void
  importThemes: (themes: BroadcastTheme[]) => number
  deleteTheme: (id: string) => void
  duplicateTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setAltActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  setLiveVerse: (verse: VerseRenderData | null) => void
  syncBroadcastOutput: () => void
  syncBroadcastOutputFor: (outputId: string) => void

  // Designer actions
  setDesignerOpen: (open: boolean) => void
  startEditing: (themeId: string) => void
  updateDraft: (updates: Partial<BroadcastTheme>) => void
  updateDraftNested: (path: string, value: unknown) => void
  saveDraft: () => void
  discardDraft: () => void
  setSelectedElement: (el: SelectedElement) => void
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const keys = path.split(".")
  const isIndex = (key: string) => /^\d+$/.test(key)
  const result: Record<string, unknown> = Array.isArray(obj) ? [...obj] as unknown as Record<string, unknown> : { ...obj }

  let current: Record<string, unknown> | unknown[] = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    const nextKey = keys[i + 1]
    const currentIndex = isIndex(key) ? Number(key) : key
    const existing = (current as Record<string, unknown> | unknown[])[currentIndex as keyof typeof current]
    const nextContainer = Array.isArray(existing)
      ? [...existing]
      : existing && typeof existing === "object"
        ? { ...(existing as Record<string, unknown>) }
        : isIndex(nextKey)
          ? []
          : {}

    ;(current as Record<string, unknown> | unknown[])[currentIndex as keyof typeof current] = nextContainer as never
    current = nextContainer as Record<string, unknown> | unknown[]
  }

  const lastKey = keys[keys.length - 1]
  const lastIndex = isIndex(lastKey) ? Number(lastKey) : lastKey
  ;(current as Record<string, unknown> | unknown[])[lastIndex as keyof typeof current] = value as never

  return result
}

function shouldSyncDraftForOutput(
  outputId: "main" | "alt",
  state: Pick<BroadcastState, "activeThemeId" | "altActiveThemeId" | "editingThemeId" | "draftTheme">,
) {
  const themeId = outputId === "alt" ? state.altActiveThemeId : state.activeThemeId
  return Boolean(state.draftTheme && state.editingThemeId === themeId)
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  themes: [...BUILTIN_THEMES],
  activeThemeId: BUILTIN_THEMES[0].id,
  altActiveThemeId: BUILTIN_THEMES[0].id,
  isLive: false,
  liveVerse: null,
  isDesignerOpen: false,
  editingThemeId: null,
  draftTheme: null,
  selectedElement: null,

  loadThemes: () => {
    set({ themes: [...BUILTIN_THEMES] })
  },
  saveTheme: (theme) => {
    set((s) => ({
      themes: s.themes.some((t) => t.id === theme.id)
        ? s.themes.map((t) => (t.id === theme.id ? theme : t))
        : [...s.themes, theme],
    }))
    get().syncBroadcastOutput()
  },
  renameTheme: (id, name) => {
    const nextName = name.trim()
    if (!nextName) return

    set((state) => ({
      themes: state.themes.map((theme) =>
        theme.id === id
          ? { ...theme, name: nextName, updatedAt: Date.now() }
          : theme,
      ),
      draftTheme:
        state.draftTheme?.id === id
          ? { ...state.draftTheme, name: nextName, updatedAt: Date.now() }
          : state.draftTheme,
    }))
  },
  importThemes: (themes) => {
    const importedThemes = sanitizeImportedThemes(themes, get().themes)
    if (importedThemes.length === 0) return 0

    set((state) => ({
      themes: [...state.themes, ...importedThemes],
    }))
    return importedThemes.length
  },
  deleteTheme: (id) => {
    set((state) => {
      const themeToDelete = state.themes.find((theme) => theme.id === id)
      if (!themeToDelete || themeToDelete.builtin) {
        return state
      }

      const remainingThemes = state.themes.filter((theme) => theme.id !== id)
      const fallbackThemeId = remainingThemes[0]?.id ?? BUILTIN_THEMES[0].id

      return {
        themes: remainingThemes,
        activeThemeId: state.activeThemeId === id ? fallbackThemeId : state.activeThemeId,
        altActiveThemeId: state.altActiveThemeId === id ? fallbackThemeId : state.altActiveThemeId,
        editingThemeId: state.editingThemeId === id ? null : state.editingThemeId,
        draftTheme: state.draftTheme?.id === id ? null : state.draftTheme,
        selectedElement: state.draftTheme?.id === id ? null : state.selectedElement,
      }
    })
    get().syncBroadcastOutput()
  },
  duplicateTheme: (id) => {
    const s = get()
    const source = s.themes.find((t) => t.id === id)
    if (!source) return
    const newTheme: BroadcastTheme = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} Copy`,
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => ({ themes: [...s.themes, newTheme] }))
  },
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const themeId = outputId === "alt" ? s.altActiveThemeId : s.activeThemeId
    const label = outputId === "alt" ? "broadcast-alt" : "broadcast"
    const theme = resolveRenderableTheme({
      themes: s.themes,
      themeId,
      draftTheme: shouldSyncDraftForOutput(outputId as "main" | "alt", s) ? s.draftTheme : null,
      editingThemeId: s.editingThemeId,
    })
    if (!theme) return

    void emitTo(label, "broadcast:verse-update", {
      theme,
      verse: s.liveVerse,
    }).catch(() => {})
  },
  syncBroadcastOutput: () => {
    get().syncBroadcastOutputFor("main")
    get().syncBroadcastOutputFor("alt")
  },
  setActiveTheme: (activeThemeId) => {
    set({ activeThemeId })
    get().syncBroadcastOutputFor("main")
  },
  setAltActiveTheme: (altActiveThemeId) => {
    set({ altActiveThemeId })
    get().syncBroadcastOutputFor("alt")
  },
  setLive: (isLive) => set({ isLive }),
  setLiveVerse: (liveVerse) => {
    set({ liveVerse })
    get().syncBroadcastOutput()
  },

  // Designer
  setDesignerOpen: (isDesignerOpen) => {
    const wasEditingActiveTheme =
      get().editingThemeId === get().activeThemeId ||
      get().editingThemeId === get().altActiveThemeId
    if (!isDesignerOpen) {
      set({ isDesignerOpen, editingThemeId: null, draftTheme: null, selectedElement: null })
      if (wasEditingActiveTheme) {
        get().syncBroadcastOutput()
      }
    } else {
      set({ isDesignerOpen })
    }
  },
  startEditing: (themeId) => {
    const theme = get().themes.find((t) => t.id === themeId)
    if (!theme) return
    set({
      editingThemeId: themeId,
      draftTheme: { ...theme, updatedAt: Date.now() },
      selectedElement: null,
    })
    if (themeId === get().activeThemeId) {
      get().syncBroadcastOutputFor("main")
    }
    if (themeId === get().altActiveThemeId) {
      get().syncBroadcastOutputFor("alt")
    }
  },
  updateDraft: (updates) => {
    set((s) => ({
      draftTheme: s.draftTheme ? { ...s.draftTheme, ...updates, updatedAt: Date.now() } : null,
    }))
    const state = get()
    if (state.editingThemeId === state.activeThemeId) {
      state.syncBroadcastOutputFor("main")
    }
    if (state.editingThemeId === state.altActiveThemeId) {
      state.syncBroadcastOutputFor("alt")
    }
  },
  updateDraftNested: (path, value) => {
    set((s) => ({
      draftTheme: s.draftTheme
        ? (setNestedValue(s.draftTheme as unknown as Record<string, unknown>, path, value) as unknown as BroadcastTheme)
        : null,
    }))
    const state = get()
    if (state.editingThemeId === state.activeThemeId) {
      state.syncBroadcastOutputFor("main")
    }
    if (state.editingThemeId === state.altActiveThemeId) {
      state.syncBroadcastOutputFor("alt")
    }
  },
  saveDraft: () => {
    const { draftTheme } = get()
    if (!draftTheme) return
    // If editing a builtin, save as a new custom theme
    if (draftTheme.builtin) {
      const customTheme = {
        ...draftTheme,
        id: crypto.randomUUID(),
        name: `${draftTheme.name} (Custom)`,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set((s) => ({
        themes: [...s.themes, customTheme],
        activeThemeId: customTheme.id,
        editingThemeId: customTheme.id,
        draftTheme: customTheme,
      }))
      get().syncBroadcastOutput()
    } else {
      get().saveTheme(draftTheme)
    }
  },
  discardDraft: () => {
    const { editingThemeId } = get()
    if (editingThemeId) {
      get().startEditing(editingThemeId)
    }
  },
  setSelectedElement: (selectedElement) => set({ selectedElement }),
}))
