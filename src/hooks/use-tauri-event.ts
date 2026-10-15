import { useEffect, useLayoutEffect, useRef } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler)
  useLayoutEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    // Track whether this effect has been cleaned up.
    // React StrictMode unmounts/remounts effects, and the listen() Promise
    // may resolve after cleanup — the cancelled flag prevents stale listeners.
    let cancelled = false
    let unlisten: UnlistenFn | undefined

    listen<T>(event, (e) => {
      if (!cancelled) {
        handlerRef.current(e.payload)
      }
    }).then((fn) => {
      if (cancelled) {
        // Effect was already cleaned up before the listener registered — remove it immediately
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [event])
}
