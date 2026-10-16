import { useEffect } from "react"
import { connectKeyboardShortcuts } from "@/lib/shortcut-registry"
import { runShortcutCommand } from "@/lib/operator-shortcuts"
import { connectOutsideMaintenance } from "@/lib/operator-maintenance"
/** The single app-root owner; panels expose focus/action targets only. */
export function useKeyboardShortcuts() {
  useEffect(() => connectOutsideMaintenance(() => connectKeyboardShortcuts(runShortcutCommand)), [])
}
