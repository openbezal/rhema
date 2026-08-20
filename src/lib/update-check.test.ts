import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UpdateStatus } from "@/types"

const mockInvoke = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { fetchUpdateStatus } from "./update-check"

const NEWER: UpdateStatus = {
  current: "0.3.2",
  latest: "0.3.3",
  url: "https://github.com/openbezal/rhema/releases/tag/v0.3.3",
  isNewer: true,
}

describe("fetchUpdateStatus", () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("returns the backend's status", async () => {
    mockInvoke.mockResolvedValue(NEWER)

    await expect(fetchUpdateStatus()).resolves.toEqual(NEWER)
    expect(mockInvoke).toHaveBeenCalledWith("check_for_update")
  })

  it("resolves to null when the check fails, rather than throwing", async () => {
    mockInvoke.mockRejectedValue(new Error("offline"))

    await expect(fetchUpdateStatus()).resolves.toBeNull()
  })
})
