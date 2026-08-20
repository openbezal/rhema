import { invoke } from "@tauri-apps/api/core"
import type { UpdateStatus } from "@/types"

/**
 * Ask the backend whether a newer release is published.
 *
 * Returns `null` instead of throwing when the check fails. Being offline is
 * ordinary in a lot of church buildings, and a version lookup is never worth
 * interrupting an operator over — callers render nothing when this is `null`.
 */
export async function fetchUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    return await invoke<UpdateStatus>("check_for_update")
  } catch (error) {
    console.warn("[UPDATE] check failed:", error)
    return null
  }
}
