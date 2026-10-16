import { create } from "zustand"

// Latch until restart: a later successful read cannot hydrate stores that
// already completed startup using defaults after the earlier failure.
export const useProfileStatusStore = create<{ readFailed: boolean }>(() => ({
  readFailed: false,
}))
