/** In-app shortcuts only. OS-global registrations remain owned by Tauri. */
export const shortcutDefinitions = [
  {
    id: "toggle-live",
    label: "Toggle live output",
    bindings: ["Space"],
    group: "Operator",
  },
  {
    id: "toggle-transcription",
    label: "Start / stop transcription",
    bindings: ["S"],
    group: "Operator",
  },
  {
    id: "focus-search",
    label: "Focus search input",
    bindings: ["/"],
    group: "Operator",
  },
  {
    id: "show-shortcuts",
    label: "Show keyboard shortcuts",
    bindings: ["?"],
    group: "Operator",
  },
  {
    id: "show-commands",
    label: "Open command palette",
    bindings: ["Mod+K"],
    group: "Operator",
  },
  {
    id: "escape",
    label: "Unfocus / leave reading mode",
    bindings: ["Escape"],
    group: "Operator",
  },
  {
    id: "focus-transcript",
    label: "Focus Transcript",
    bindings: ["G T"],
    group: "Panels",
  },
  {
    id: "focus-queue",
    label: "Focus Queue",
    bindings: ["G Q"],
    group: "Panels",
  },
  {
    id: "focus-search-panel",
    label: "Focus Search panel",
    bindings: ["G S"],
    group: "Panels",
  },
  {
    id: "focus-detections",
    label: "Focus Detections",
    bindings: ["G D"],
    group: "Panels",
  },
  {
    id: "focus-preview",
    label: "Focus Program preview",
    bindings: ["G P"],
    group: "Panels",
  },
  {
    id: "focus-live",
    label: "Focus Live output",
    bindings: ["G L"],
    group: "Panels",
  },
  {
    id: "previous-verse",
    label: "Present previous verse",
    bindings: ["["],
    group: "Reading",
  },
  {
    id: "next-verse",
    label: "Present next verse",
    bindings: ["]"],
    group: "Reading",
  },
  {
    id: "previous-chapter",
    label: "Present previous chapter",
    bindings: ["{"],
    group: "Reading",
  },
  {
    id: "next-chapter",
    label: "Present next chapter",
    bindings: ["}"],
    group: "Reading",
  },
  {
    id: "list-next",
    label: "Focus next list item",
    bindings: ["J", "ArrowDown"],
    group: "Focused list",
  },
  {
    id: "list-previous",
    label: "Focus previous list item",
    bindings: ["K", "ArrowUp"],
    group: "Focused list",
  },
  {
    id: "list-present",
    label: "Present focused item",
    bindings: ["Enter"],
    group: "Focused list",
  },
  {
    id: "list-present-clear",
    label: "Present and clear Queue selection",
    bindings: ["Mod+Enter"],
    group: "Focused list",
  },
  {
    id: "list-remove",
    label: "Remove focused Queue item",
    bindings: ["Backspace", "Delete"],
    group: "Focused list",
  },
] as const
export type ShortcutId = (typeof shortcutDefinitions)[number]["id"]
export function shortcutHint(id: ShortcutId) {
  return shortcutDefinitions
    .find((item) => item.id === id)!
    .bindings.join(" / ")
}
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input,textarea,select,[role="textbox"],[role="combobox"],[contenteditable]:not([contenteditable="false"])'
      )
    )
  )
}
export function hasOpenOperatorDialog(): boolean {
  return [
    ...document.querySelectorAll(
      '[role="dialog"],[role="alertdialog"],dialog[open],[role="menu"],[role="listbox"]'
    ),
  ].some((element) => {
    if (element.closest('[hidden],[aria-hidden="true"],[data-state="closed"]'))
      return false
    const style = getComputedStyle(element)
    return style.display !== "none" && style.visibility !== "hidden"
  })
}
/** Bubble phase lets a local editor/menu consume its own keys first. */
export function connectKeyboardShortcuts(
  run: (id: ShortcutId, event: KeyboardEvent) => unknown
): () => void {
  let chordUntil = 0
  const reset = () => {
    chordUntil = 0
  }
  const handle = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.repeat ||
      event.altKey ||
      hasOpenOperatorDialog()
    ) {
      reset()
      return
    }
    const key =
      event.key === " "
        ? "Space"
        : event.key.length === 1 && /[a-z]/i.test(event.key)
          ? event.key.toUpperCase()
          : event.key
    if (isEditableTarget(event.target) && key !== "Escape") {
      reset()
      return
    }
    // Preserve native activation of a focused button/switch/link. Other verbs
    // can still run from a focused card; popup menus own their entire keyboard.
    if (
      (key === "Space" || key === "Enter") &&
      event.target instanceof Element &&
      event.target.closest('button,a[href],[role="button"],[role="switch"]') &&
      !event.target.matches("[data-operator-item]")
    ) {
      reset()
      return
    }
    if (
      (event.ctrlKey && event.metaKey) ||
      (event.shiftKey && !["?", "{", "}"].includes(key))
    ) {
      reset()
      return
    }
    const modified = event.metaKey || event.ctrlKey
    const binding = modified ? `Mod+${key}` : key
    const list =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-operator-list]")
        : null
    const chord =
      chordUntil > Date.now() && !modified && key !== "Escape"
        ? `G ${key}`
        : null
    reset()
    if (key === "G" && !modified && !event.shiftKey) {
      chordUntil = Date.now() + 1000
      event.preventDefault()
      return
    }
    const definition = shortcutDefinitions.find(
      (item) =>
        (item.bindings as readonly string[]).includes(chord ?? binding) &&
        (!modified || !event.shiftKey) &&
        (item.group !== "Focused list" || list) &&
        (item.id !== "list-remove" || list?.dataset.operatorList === "queue") &&
        (item.id !== "list-present-clear" ||
          list?.dataset.operatorList === "queue")
    )
    if (!definition) return
    event.preventDefault()
    try {
      void Promise.resolve(run(definition.id, event)).catch((error: unknown) =>
        console.warn("[keyboard] Command failed:", error)
      )
    } catch (error) {
      console.warn("[keyboard] Command failed:", error)
    }
  }
  document.addEventListener("keydown", handle)
  document.addEventListener("pointerdown", reset)
  window.addEventListener("blur", reset)
  document.addEventListener("focusin", reset)
  document.addEventListener("compositionstart", reset)
  return () => {
    reset()
    document.removeEventListener("keydown", handle)
    document.removeEventListener("pointerdown", reset)
    window.removeEventListener("blur", reset)
    document.removeEventListener("focusin", reset)
    document.removeEventListener("compositionstart", reset)
  }
}
