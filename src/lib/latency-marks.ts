import { invoke } from "@tauri-apps/api/core"

/**
 * Latency instrumentation for the detection → screen pipeline.
 *
 * Each mark logs to the webview console AND is forwarded to the backend
 * (`ui_mark` command), which writes it into the same log stream as the
 * backend's `[LAT]` marks. Both sides stamp epoch milliseconds from the
 * same machine clock, so a single log file yields the full timeline:
 * partial → final → worker → emit → ui receive → store → commit → paint.
 */
export function mark(label: string): void {
  const t = Date.now()
  console.log(`[LAT] ui ${label} t=${t}`)
  // Defensive: never let instrumentation break the app (or tests that mock
  // invoke without covering ui_mark).
  try {
    void Promise.resolve(invoke("ui_mark", { label, epochMs: t })).catch(() => {})
  } catch {
    // ignore — marks are best-effort
  }
}

let longTasksObserved = false

/**
 * Report main-thread stalls (>50ms long tasks) into the latency log.
 * Safari/WKWebView may not support the "longtask" entry type — in that
 * case this is a silent no-op and the receive→paint marks still bound
 * any render stall.
 */
export function observeLongTasks(): void {
  if (longTasksObserved) return
  longTasksObserved = true
  if (typeof PerformanceObserver === "undefined") return
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        mark(`longtask dur=${Math.round(entry.duration)}ms name=${entry.name}`)
      }
    })
    observer.observe({ type: "longtask", buffered: false })
  } catch {
    // longtask not supported in this webview — receive→paint marks still apply
  }
}
