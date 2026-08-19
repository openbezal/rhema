import { warn as logWarn, error as logError } from "@tauri-apps/plugin-log"

/**
 * Forward frontend failures into the log file.
 *
 * Note this is the opposite direction to the plugin's `attachConsole()`, which
 * pipes *Rust* logs into the browser console — useful in devtools, useless in
 * a bug report. Without this, every `console.error` and every uncaught React
 * error exists only in a devtools panel nobody has open, so the logs a user
 * sends us are silent about frontend faults.
 *
 * Only warnings and errors are forwarded. `console.log`/`debug` are far too
 * chatty to put in a file that has to stay readable.
 */
export function forwardConsoleToLog(): void {
  const originalWarn = console.warn.bind(console)
  const originalError = console.error.bind(console)

  const render = (args: unknown[]) =>
    args
      .map((arg) => {
        if (typeof arg === "string") return arg
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(" ")

  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    void logWarn(render(args)).catch(() => {})
  }

  console.error = (...args: unknown[]) => {
    originalError(...args)
    void logError(render(args)).catch(() => {})
  }

  window.addEventListener("error", (event) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno})` : ""
    void logError(`[uncaught] ${event.message}${where}`).catch(() => {})
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? `${event.reason.name}: ${event.reason.message}`
        : String(event.reason)
    void logError(`[unhandled rejection] ${reason}`).catch(() => {})
  })
}
