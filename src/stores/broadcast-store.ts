import { create } from "zustand"
import { emitTo } from "@tauri-apps/api/event"
import { load, type Store } from "@tauri-apps/plugin-store"
import type {
  BroadcastOutput,
  BroadcastOutputStatus,
  BroadcastTheme,
  Verse,
  VerseRenderData,
} from "@/types"
import { MAIN_OUTPUT_ID, defaultNdiSettings, outputWindowLabel } from "@/types"
import { BUILTIN_THEMES, BROADCAST_OVERLAY, CLASSIC_DARK } from "@/lib/builtin-themes"
import { normalizeTheme } from "@/lib/theme-migrations"

type SelectedElement = "verse" | "reference" | null

export type NewThemeLayoutKind = "fullscreen" | "lower-thirds"

interface BroadcastState {
  themes: BroadcastTheme[]
  /** Mirror of the main output's themeId, kept for existing consumers. */
  activeThemeId: string
  /** Every configured broadcast output; the "main" output is always present. */
  outputs: BroadcastOutput[]
  /** Runtime on-air state per output id. Not persisted. */
  outputStatus: Record<string, BroadcastOutputStatus>
  isLive: boolean
  liveVerse: VerseRenderData | null
  // The Verse the live output was presented from, kept so it can be
  // re-presented (e.g. after a translation change). Preview selection never
  // writes this — only an explicit present does.
  liveSourceVerse: Verse | null
  // When on, detections auto-present to the live output. When off, the live
  // output only changes via explicit presents (manual operator control).
  autoLive: boolean

  // Designer state
  isDesignerOpen: boolean
  editingThemeId: string | null
  renamingThemeId: string | null
  draftTheme: BroadcastTheme | null
  selectedElement: SelectedElement

  // Theme management
  loadThemes: () => void
  saveTheme: (theme: BroadcastTheme) => void
  deleteTheme: (id: string) => void
  duplicateTheme: (id: string) => void
  createNewTheme: (layoutKind?: NewThemeLayoutKind) => void
  renameTheme: (id: string, name: string) => void
  togglePinTheme: (id: string) => void
  setActiveTheme: (id: string) => void
  setLive: (live: boolean) => void
  setLiveVerse: (verse: VerseRenderData | null, source?: Verse | null) => void
  setAutoLive: (auto: boolean) => void
  syncBroadcastOutput: () => void
  syncBroadcastOutputFor: (outputId: string) => void

  // Output management
  addOutput: (output: BroadcastOutput) => void
  updateOutput: (id: string, patch: Partial<Omit<BroadcastOutput, "id">>) => void
  removeOutput: (id: string) => void
  duplicateOutput: (id: string) => void
  renameOutput: (id: string, name: string) => void
  setOutputTheme: (id: string, themeId: string) => void
  setOutputStatus: (id: string, status: BroadcastOutputStatus) => void

  // Designer actions
  setDesignerOpen: (open: boolean) => void
  startEditing: (themeId: string) => void
  stopEditing: () => void
  updateDraft: (updates: Partial<BroadcastTheme>) => void
  updateDraftNested: (path: string, value: unknown) => void
  saveDraft: () => void
  discardDraft: () => void
  setSelectedElement: (el: SelectedElement) => void
  setRenamingTheme: (id: string | null) => void
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

function emitDraftToBroadcast(state: BroadcastState): void {
  if (!state.draftTheme) return
  const verse = state.isLive ? state.liveVerse : null
  for (const output of state.outputs) {
    if (output.themeId !== state.editingThemeId) continue
    void emitTo(outputWindowLabel(output.id), "broadcast:verse-update", {
      theme: state.draftTheme,
      verse,
    }).catch(() => {})
  }
}

function defaultMainOutput(): BroadcastOutput {
  return {
    id: MAIN_OUTPUT_ID,
    name: "Main Display",
    type: "display",
    themeId: BUILTIN_THEMES[0].id,
    monitorIndex: 0,
    // Keeps the pre-multi-output source name so upgrading users' NDI
    // receivers stay bound after the migration.
    ndi: defaultNdiSettings("Rhema Output"),
  }
}

/**
 * Build the outputs list from the pre-multi-output persisted keys. The alt
 * slot always persisted its default theme id, so a value equal to the builtin
 * default means the alt output was never actually used — skip it then.
 */
export function migrateLegacyOutputs(
  activeThemeId?: string,
  altActiveThemeId?: string
): BroadcastOutput[] {
  const main = defaultMainOutput()
  if (activeThemeId) main.themeId = activeThemeId
  const outputs = [main]
  if (altActiveThemeId && altActiveThemeId !== BUILTIN_THEMES[0].id) {
    outputs.push({
      id: "alt",
      name: "Alternate Output",
      type: "ndi",
      themeId: altActiveThemeId,
      monitorIndex: 0,
      ndi: defaultNdiSettings("Rhema Alt"),
    })
  }
  return outputs
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  themes: [...BUILTIN_THEMES],
  activeThemeId: BUILTIN_THEMES[0].id,
  outputs: [defaultMainOutput()],
  outputStatus: {},
  isLive: false,
  liveVerse: null,
  liveSourceVerse: null,
  autoLive: true,
  isDesignerOpen: false,
  editingThemeId: null,
  renamingThemeId: null,
  draftTheme: null,
  selectedElement: null,

  loadThemes: () => {
    set({ themes: [...BUILTIN_THEMES] })
  },
  saveTheme: (theme) =>
    set((s) => ({
      themes: s.themes.some((t) => t.id === theme.id)
        ? s.themes.map((t) => (t.id === theme.id ? theme : t))
        : [...s.themes, theme],
    })),
  deleteTheme: (id) =>
    set((s) => ({ themes: s.themes.filter((t) => t.id !== id || t.builtin) })),
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
  createNewTheme: (layoutKind = "fullscreen") => {
    // Lower thirds start from Broadcast Overlay (transparent background for
    // NDI keying, text box band at the bottom); fullscreen from Classic Dark.
    const source = layoutKind === "lower-thirds" ? BROADCAST_OVERLAY : CLASSIC_DARK
    const newTheme: BroadcastTheme = {
      ...source,
      id: crypto.randomUUID(),
      name: "Untitled Theme",
      builtin: false,
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(layoutKind === "fullscreen"
        ? {
            background: {
              type: "solid" as const,
              color: "#000000",
              gradient: null,
              image: null,
            },
          }
        : {}),
    }
    set((s) => ({ themes: [...s.themes, newTheme] }))
    get().startEditing(newTheme.id)
  },
  renameTheme: (id, name) =>
    set((s) => ({
      themes: s.themes.map((t) =>
        t.id === id && !t.builtin ? { ...t, name, updatedAt: Date.now() } : t
      ),
      draftTheme:
        s.draftTheme?.id === id ? { ...s.draftTheme, name, updatedAt: Date.now() } : s.draftTheme,
    })),
  togglePinTheme: (id) =>
    set((s) => ({
      themes: s.themes.map((t) =>
        t.id === id ? { ...t, pinned: !t.pinned, updatedAt: Date.now() } : t
      ),
    })),
  syncBroadcastOutputFor: (outputId: string) => {
    const s = get()
    const output = s.outputs.find((o) => o.id === outputId)
    if (!output) return
    const theme = s.themes.find((t) => t.id === output.themeId) ?? s.themes[0]
    if (!theme) return

    void emitTo(outputWindowLabel(outputId), "broadcast:verse-update", {
      theme,
      verse: s.isLive ? s.liveVerse : null,
    }).catch(() => {})
  },
  syncBroadcastOutput: () => {
    for (const output of get().outputs) {
      get().syncBroadcastOutputFor(output.id)
    }
  },
  setActiveTheme: (activeThemeId) => {
    get().setOutputTheme(MAIN_OUTPUT_ID, activeThemeId)
  },

  // Output management
  addOutput: (output) =>
    set((s) => ({
      outputs: s.outputs.some((o) => o.id === output.id)
        ? s.outputs
        : [...s.outputs, output],
    })),
  updateOutput: (id, patch) => {
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, ...patch, id } : o)),
      ...(id === MAIN_OUTPUT_ID && patch.themeId
        ? { activeThemeId: patch.themeId }
        : {}),
    }))
    if (patch.themeId) get().syncBroadcastOutputFor(id)
  },
  removeOutput: (id) => {
    if (id === MAIN_OUTPUT_ID) return
    set((s) => {
      const outputStatus = Object.fromEntries(
        Object.entries(s.outputStatus).filter(([statusId]) => statusId !== id)
      )
      return {
        outputs: s.outputs.filter((o) => o.id !== id),
        outputStatus,
      }
    })
  },
  duplicateOutput: (id) => {
    const s = get()
    const source = s.outputs.find((o) => o.id === id)
    if (!source) return
    const takenNames = new Set(s.outputs.map((o) => o.name))
    const takenSources = new Set(s.outputs.map((o) => o.ndi.sourceName))
    let name = `${source.name} Copy`
    let sourceName = `${source.ndi.sourceName} Copy`
    for (let n = 2; takenNames.has(name); n++) name = `${source.name} Copy ${n}`
    // Two NDI senders with the same source name collide on the network.
    for (let n = 2; takenSources.has(sourceName); n++)
      sourceName = `${source.ndi.sourceName} Copy ${n}`
    get().addOutput({
      ...source,
      id: crypto.randomUUID(),
      name,
      ndi: { ...source.ndi, sourceName },
    })
  },
  renameOutput: (id, name) =>
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, name } : o)),
    })),
  setOutputTheme: (id, themeId) => {
    set((s) => ({
      outputs: s.outputs.map((o) => (o.id === id ? { ...o, themeId } : o)),
      ...(id === MAIN_OUTPUT_ID ? { activeThemeId: themeId } : {}),
    }))
    get().syncBroadcastOutputFor(id)
  },
  setOutputStatus: (id, status) =>
    set((s) => {
      const prev = s.outputStatus[id]
      if (prev && prev.previewOpen === status.previewOpen && prev.ndiActive === status.ndiActive) {
        return s
      }
      return { outputStatus: { ...s.outputStatus, [id]: status } }
    }),
  setLive: (isLive) => {
    set({ isLive })
    get().syncBroadcastOutput()
  },
  setLiveVerse: (liveVerse, source = null) => {
    set({ liveVerse, liveSourceVerse: source })
    get().syncBroadcastOutput()
  },
  setAutoLive: (autoLive) => set({ autoLive }),

  // Designer
  setDesignerOpen: (isDesignerOpen) => {
    if (!isDesignerOpen) {
      set({ isDesignerOpen, editingThemeId: null, draftTheme: null, selectedElement: null })
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
  },
  stopEditing: () => {
    set({
      editingThemeId: null,
      draftTheme: null,
      selectedElement: null,
    })
  },
  updateDraft: (updates) => {
    set((s) => ({
      draftTheme: s.draftTheme ? { ...s.draftTheme, ...updates, updatedAt: Date.now() } : null,
    }))
    emitDraftToBroadcast(get())
  },
  updateDraftNested: (path, value) => {
    set((s) => ({
      draftTheme: s.draftTheme
        ? (setNestedValue(s.draftTheme as unknown as Record<string, unknown>, path, value) as unknown as BroadcastTheme)
        : null,
    }))
    emitDraftToBroadcast(get())
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
        editingThemeId: customTheme.id,
        draftTheme: customTheme,
      }))
      // Point every output that was on the builtin at the saved copy, so the
      // outputs and the in-app preview never disagree about what is showing.
      for (const output of get().outputs) {
        if (output.themeId === draftTheme.id) {
          get().setOutputTheme(output.id, customTheme.id)
        }
      }
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
  setRenamingTheme: (id) => set({ renamingThemeId: id }),
}))

// ── Theme persistence via tauri-plugin-store ──

let tauriStore: Store | null = null
let hydrationPromise: Promise<void> | null = null

async function getThemeStore(): Promise<Store> {
  if (!tauriStore) {
    tauriStore = await load("broadcast-themes.json", { autoSave: false, defaults: {} })
  }
  return tauriStore
}

export function hydrateBroadcastThemes(): Promise<void> {
  if (hydrationPromise) return hydrationPromise
  hydrationPromise = (async () => {
    try {
      const store = await getThemeStore()
      const customThemes = (await store.get("customThemes")) as BroadcastTheme[] | undefined
      const outputs = (await store.get("outputs")) as BroadcastOutput[] | undefined
      const activeId = (await store.get("activeThemeId")) as string | undefined
      const altActiveId = (await store.get("altActiveThemeId")) as string | undefined
      const autoLive = (await store.get("autoLive")) as boolean | undefined

      const patch: Partial<BroadcastState> = {}
      if (customThemes && Array.isArray(customThemes) && customThemes.length > 0) {
        patch.themes = [...BUILTIN_THEMES, ...customThemes.map(normalizeTheme)]
      }
      patch.outputs =
        outputs && Array.isArray(outputs) && outputs.length > 0
          ? outputs
          : migrateLegacyOutputs(activeId, altActiveId)
      const main = patch.outputs.find((o) => o.id === MAIN_OUTPUT_ID)
      if (main) patch.activeThemeId = main.themeId
      if (typeof autoLive === "boolean") patch.autoLive = autoLive

      useBroadcastStore.setState(patch)

      // Auto-persist on changes (debounced)
      useBroadcastStore.subscribe((state, prevState) => {
        const changed =
          state.themes !== prevState.themes ||
          state.activeThemeId !== prevState.activeThemeId ||
          state.outputs !== prevState.outputs ||
          state.autoLive !== prevState.autoLive
        if (!changed) return
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          saveTimer = null
          pendingSave = pendingSave.then(() =>
            persistBroadcastThemes(useBroadcastStore.getState())
          )
        }, SAVE_DEBOUNCE_MS)
      })
    } catch {
      console.warn("[broadcast] Failed to load persisted themes, using defaults")
    }
  })()
  return hydrationPromise
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingSave: Promise<void> = Promise.resolve()
const SAVE_DEBOUNCE_MS = 500

async function persistBroadcastThemes(state: BroadcastState): Promise<void> {
  try {
    const store = await getThemeStore()
    const customThemes = state.themes.filter((t) => !t.builtin)
    await store.set("customThemes", customThemes)
    await store.set("outputs", state.outputs)
    // Legacy mirror of the main output's theme; older builds still read it.
    await store.set("activeThemeId", state.activeThemeId)
    await store.set("autoLive", state.autoLive)
    await store.save()
  } catch {
    console.warn("[broadcast] Failed to persist themes")
  }
}
