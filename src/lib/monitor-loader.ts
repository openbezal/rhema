import type { Monitor } from "@tauri-apps/api/window"

/** Keep discovery state tied to the latest request, including automatic loads. */
export function createMonitorLoader(
  read: () => Promise<Monitor[]>,
  onMonitors: (monitors: Monitor[]) => void,
  onPending: (pending: boolean) => void,
  onError: (error: unknown) => void
): () => Promise<void> {
  let revision = 0
  return async () => {
    const request = ++revision
    onPending(true)
    try {
      const monitors = await read()
      if (request === revision) onMonitors(monitors)
    } catch (error) {
      if (request === revision) {
        onMonitors([])
        onError(error)
      }
    } finally {
      if (request === revision) onPending(false)
    }
  }
}
