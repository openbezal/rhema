import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BroadcastOutput } from "@/types"
import { defaultNdiSettings } from "@/types"

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), windows: vi.fn(), ask: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/window", () => ({ getAllWindows: mocks.windows }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-log", () => ({ info: vi.fn().mockResolvedValue(undefined), error: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mocks.ask }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
import { useBroadcastStore } from "@/stores/broadcast-store"
import { requestOnAir, setOutputEnabled, removeOutputSafely, updateOutputSafely } from "./output-safety"
import { remoteActions } from "./remote-actions"
import { broadcastActions } from "@/hooks/use-broadcast"

const output: BroadcastOutput = { id: "ndi-a", name: "Stage feed", type: "ndi", themeId: "", monitorIndex: 0, ndi: defaultNdiSettings("Stage") }
const visible = (id: string, shown: boolean) => ({ label: `broadcast-${id}`, isVisible: vi.fn().mockResolvedValue(shown) })
const stopCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === "stop_ndi")
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockImplementation(async (command: string) => command === "get_ndi_status" ? { active: false } : undefined)
  mocks.windows.mockResolvedValue([])
  mocks.ask.mockResolvedValue(false)
  useBroadcastStore.setState({ outputs: [output], outputStatus: {}, isLive: false, liveVerse: null, liveSourceVerse: null })
})

describe("going on air", () => {
  it("warns when only a hidden renderer remains after an NDI failure", async () => {
    mocks.windows.mockResolvedValue([visible(output.id, false)])
    expect(await requestOnAir(true)).toBe(false)
    expect(mocks.ask).toHaveBeenCalledOnce()
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
  it.each([
    ["UI/HTTP/OSC registry", remoteActions.toggleOnAir],
    ["broadcast compatibility action", broadcastActions.setLive],
  ])("uses the same warning through %s", async (_, action) => {
    await action(true)
    expect(useBroadcastStore.getState().isLive).toBe(false)
    expect(mocks.ask).toHaveBeenCalledOnce()
  })
  it("does not count an unconfigured visible window as an audience output", async () => {
    mocks.windows.mockResolvedValue([visible("removed-output", true)])
    expect(await requestOnAir(true)).toBe(false)
    expect(mocks.ask).toHaveBeenCalledOnce()
  })
  it("accepts a visible display without warning", async () => {
    useBroadcastStore.setState({ outputs: [{ ...output, type: "display" }] })
    mocks.windows.mockResolvedValue([visible(output.id, true)])
    expect(await requestOnAir(true)).toBe(true)
    expect(mocks.ask).not.toHaveBeenCalled()
  })
  it("accepts an active NDI sender with a hidden renderer", async () => {
    mocks.windows.mockResolvedValue([visible(output.id, false)])
    mocks.invoke.mockResolvedValue({ active: true })
    expect(await requestOnAir(true)).toBe(true)
    expect(mocks.ask).not.toHaveBeenCalled()
  })
  it("ignores stale active status for a configured but stopped output", async () => {
    useBroadcastStore.setState({ outputStatus: { [output.id]: { ndiActive: true, previewOpen: false } } })
    expect(await requestOnAir(true)).toBe(false)
    expect(mocks.ask).toHaveBeenCalledOnce()
  })
  it("treats unavailable native status conservatively", async () => {
    mocks.invoke.mockRejectedValue(new Error("status unavailable"))
    mocks.windows.mockRejectedValue(new Error("window inventory unavailable"))
    expect(await requestOnAir(true)).toBe(false)
    expect(mocks.ask).toHaveBeenCalledOnce()
  })
  it("allows an explicit no-output confirmation", async () => {
    mocks.ask.mockResolvedValue(true)
    expect(await requestOnAir(true)).toBe(true)
    expect(mocks.ask).toHaveBeenCalledOnce()
    expect(useBroadcastStore.getState().isLive).toBe(true)
  })
  it("does not revive on air after an off command while confirmation is pending", async () => {
    const answer = deferred<boolean>(); mocks.ask.mockReturnValue(answer.promise)
    const pending = requestOnAir(true)
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce())
    await requestOnAir(false)
    answer.resolve(true)
    expect(await pending).toBe(false)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
  it("discards a no-output confirmation after the output configuration changes", async () => {
    const answer = deferred<boolean>(); mocks.ask.mockReturnValue(answer.promise)
    const pending = requestOnAir(true)
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce())
    useBroadcastStore.getState().updateOutput(output.id, { name: "Changed feed" })
    answer.resolve(true)
    expect(await pending).toBe(false)
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })
  it("coalesces double activation into one confirmation", async () => {
    mocks.ask.mockResolvedValue(true)
    expect(await Promise.all([requestOnAir(true), requestOnAir(true)])).toEqual([true, true])
    expect(mocks.ask).toHaveBeenCalledOnce()
  })
})

describe("changing outputs", () => {
  beforeEach(() => {
    mocks.invoke.mockImplementation(async (command: string) => command === "get_ndi_status" ? { active: true } : undefined)
    useBroadcastStore.setState({ isLive: true })
  })
  it("leaves an active output running when stop is dismissed", async () => {
    expect(await setOutputEnabled(output.id, false)).toBe(false)
    expect(stopCalls()).toHaveLength(0)
  })
  it("stops exactly once after confirmation despite double activation", async () => {
    mocks.ask.mockResolvedValue(true)
    expect(await Promise.all([setOutputEnabled(output.id, false), setOutputEnabled(output.id, false)])).toEqual([true, true])
    expect(mocks.ask).toHaveBeenCalledOnce()
    expect(stopCalls()).toEqual([["stop_ndi", { outputId: output.id }]])
  })
  it("keeps a live configuration when removal is dismissed", async () => {
    expect(await removeOutputSafely(output.id)).toBe(false)
    expect(useBroadcastStore.getState().outputs).toEqual([output])
    expect(stopCalls()).toHaveLength(0)
  })
  it("retains the configuration if transport stop fails", async () => {
    mocks.ask.mockResolvedValue(true)
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "stop_ndi") throw new Error("SDK stop failed")
      return { active: true }
    })
    expect(await removeOutputSafely(output.id)).toBe(false)
    expect(useBroadcastStore.getState().outputs).toEqual([output])
  })
  it("does not stop a replacement configuration after delayed confirmation", async () => {
    const answer = deferred<boolean>(); mocks.ask.mockReturnValue(answer.promise)
    const pending = removeOutputSafely(output.id)
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalledOnce())
    useBroadcastStore.getState().updateOutput(output.id, { ndi: { ...output.ndi, sourceName: "Replacement" } })
    answer.resolve(true)
    expect(await pending).toBe(false)
    expect(stopCalls()).toHaveLength(0)
    expect(useBroadcastStore.getState().outputs[0].ndi.sourceName).toBe("Replacement")
  })
  it("does not remove the default output or interrupt its transport", async () => {
    useBroadcastStore.setState({ outputs: [{ ...output, id: "main" }] })
    expect(await removeOutputSafely("main")).toBe(false)
    expect(stopCalls()).toHaveLength(0)
  })
  it("skips stopping an already absent output", async () => {
    mocks.invoke.mockResolvedValue({ active: false })
    expect(await setOutputEnabled(output.id, false)).toBe(true)
    expect(stopCalls()).toHaveLength(0)
  })
  it("removes only the confirmed output after stopping it", async () => {
    mocks.ask.mockResolvedValue(true)
    const other = { ...output, id: "ndi-b", name: "Second feed" }
    useBroadcastStore.setState({ outputs: [output, other] })
    expect(await removeOutputSafely(output.id)).toBe(true)
    expect(useBroadcastStore.getState().outputs).toEqual([other])
    expect(stopCalls()).toEqual([["stop_ndi", { outputId: output.id }]])
  })
})


describe("editing an output transport", () => {
  const next = { ...output, ndi: { ...output.ndi, resolution: "r720p" as const } }
  beforeEach(() => {
    useBroadcastStore.setState({ isLive: true, outputStatus: { [output.id]: { previewOpen: false, ndiActive: true } } })
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "get_ndi_status") return { active: true }
      if (command === "start_ndi") return { sourceName: "Stage", width: 1280, height: 720, fps: 24 }
    })
  })
  it("does not interrupt or edit an active transport after cancellation", async () => {
    expect(await updateOutputSafely(next)).toBe(false)
    expect(stopCalls()).toHaveLength(0)
    expect(useBroadcastStore.getState().outputs).toEqual([output])
  })
  it("keeps the original transport configuration after a failed stop", async () => {
    mocks.ask.mockResolvedValue(true)
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "stop_ndi") throw new Error("Stop failed")
      return { active: true }
    })
    expect(await updateOutputSafely(next)).toBe(false)
    expect(useBroadcastStore.getState().outputs).toEqual([output])
  })
  it("confirms, stops, and restarts exactly once with the new configuration", async () => {
    mocks.ask.mockResolvedValue(true)
    expect(await updateOutputSafely(next)).toBe(true)
    expect(mocks.ask).toHaveBeenCalledOnce()
    expect(stopCalls()).toEqual([["stop_ndi", { outputId: output.id }]])
    expect(mocks.invoke).toHaveBeenCalledWith("start_ndi", { outputId: output.id, request: next.ndi })
    expect(useBroadcastStore.getState().outputs[0].ndi).toEqual(next.ndi)
  })
  it("applies theme/name changes without stopping or prompting", async () => {
    expect(await updateOutputSafely({ ...output, themeId: "new-theme", name: "New name" })).toBe(true)
    expect(stopCalls()).toHaveLength(0)
    expect(mocks.ask).not.toHaveBeenCalled()
  })
})
