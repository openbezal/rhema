import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defaultNdiSettings, type BroadcastOutput } from "@/types"
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), windows: vi.fn(), emit: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: mocks.windows }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn().mockResolvedValue(undefined), error: vi.fn().mockResolvedValue(undefined) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
import { useBroadcastStore } from "@/stores/broadcast-store"
import { enableOutput, disableOutput, reconcileOutputStatus } from "./broadcast-output-control"
const output: BroadcastOutput = { id: "feed", name: "Feed", type: "ndi", themeId: "", monitorIndex: 0, ndi: defaultNdiSettings() }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.windows.mockResolvedValue([])
  mocks.emit.mockResolvedValue(undefined)
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "get_ndi_status") return { active: false }
    if (command === "start_ndi") return { sourceName: "Feed", width: 1920, height: 1080, fps: 24 }
  })
  useBroadcastStore.setState({ outputs: [output], outputStatus: {} })
})
afterEach(() => vi.useRealTimers())
describe("output runtime lifecycle", () => {
  it("cleans the renderer and reconciles state after a failed NDI start", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "start_ndi") throw new Error("SDK unavailable")
      if (command === "get_ndi_status") return { active: false }
    })
    expect(await enableOutput(output)).toBe(false)
    expect(mocks.invoke).toHaveBeenCalledWith("stop_ndi", { outputId: output.id })
    expect(mocks.invoke).toHaveBeenCalledWith("close_broadcast_window", { outputId: output.id })
    expect(useBroadcastStore.getState().outputStatus[output.id]).toMatchObject({ previewOpen: false, ndiActive: false, error: "Error: SDK unavailable" })
  })
  it("stops a late NDI start if its output was removed during startup", async () => {
    let resolve!: (value: unknown) => void
    const session = new Promise(r => { resolve = r })
    mocks.invoke.mockImplementation(async (command: string) => command === "start_ndi" ? session : undefined)
    const pending = enableOutput(output)
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("start_ndi", expect.anything()))
    useBroadcastStore.getState().removeOutput(output.id)
    resolve({ sourceName: "Feed", width: 1920, height: 1080, fps: 24 })
    expect(await pending).toBe(false)
    expect(mocks.invoke).toHaveBeenCalledWith("stop_ndi", { outputId: output.id })
    expect(useBroadcastStore.getState().outputStatus[output.id]).toBeUndefined()
  })
  it("reports close failure instead of claiming the output stopped", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "close_broadcast_window") throw new Error("window did not close")
      return { active: false }
    })
    expect(await disableOutput({ ...output, type: "display" })).toBe(false)
  })
  it("does not reactivate NDI from a delayed startup nudge after stop", async () => {
    vi.useFakeTimers()
    expect(await enableOutput(output)).toBe(true)
    expect(await disableOutput(output)).toBe(true)
    await vi.advanceTimersByTimeAsync(350)
    const configs = mocks.emit.mock.calls.filter(([, event]) => event === "broadcast:ndi-config")
    expect(configs.at(-1)?.[2]).toMatchObject({ active: false })
  })
  it("discards a status query that predates stopping the output", async () => {
    let resolve!: (value: { active: boolean }) => void
    const late = new Promise<{ active: boolean }>(r => { resolve = r })
    mocks.invoke.mockImplementation(async (command: string) => command === "get_ndi_status" ? late : undefined)
    const pending = reconcileOutputStatus(output)
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_ndi_status", { outputId: output.id }))
    await disableOutput(output)
    resolve({ active: true }); await pending
    expect(useBroadcastStore.getState().outputStatus[output.id]).toMatchObject({ ndiActive: false, previewOpen: false })
  })
})
