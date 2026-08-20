import { useCallback, useEffect, useState } from "react"
import { fetchUpdateStatus } from "@/lib/update-check"
import type { UpdateStatus } from "@/types"

/**
 * Asks the backend once per launch whether a newer release exists.
 *
 * A failed check resolves to `null` (see fetchUpdateStatus) so callers render
 * nothing rather than surfacing a network error nobody can act on.
 */
export function useUpdateCheck(): {
  status: UpdateStatus | null
  checking: boolean
  recheck: () => Promise<void>
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  // The launch check is already in flight by first paint, so this starts true
  // rather than being flipped synchronously inside the effect below.
  const [checking, setChecking] = useState(true)

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await fetchUpdateStatus())
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    let unmounted = false

    void (async () => {
      const result = await fetchUpdateStatus()
      if (unmounted) return
      setStatus(result)
      setChecking(false)
    })()

    return () => {
      unmounted = true
    }
  }, [])

  return { status, checking, recheck }
}
