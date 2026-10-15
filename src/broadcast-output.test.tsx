// @vitest-environment jsdom
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  pixel: 0,
  active: false,
  render: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "broadcast-main",
    emitTo: vi.fn().mockResolvedValue(undefined),
    listen: vi.fn(
      (name: string, callback: (event: { payload: unknown }) => void) => {
        mocks.listeners.set(name, callback)
        return Promise.resolve(() => mocks.listeners.delete(name))
      }
    ),
  }),
}))
vi.mock("@/lib/verse-renderer", () => ({ onThemeFontsLoaded: () => () => {} }))
vi.mock("@/lib/theme-image-cache", () => ({
  preloadThemeImages: vi.fn(),
  themeImageCache: () => new Map(),
}))
vi.mock("@/lib/presentation-frame", () => ({
  renderPresentationFrame: mocks.render,
}))
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render: vi.fn() }) }))
const { createRoot } =
  await vi.importActual<typeof import("react-dom/client")>("react-dom/client")
const { BroadcastCanvas } = await import("./broadcast-output")
let root: ReturnType<typeof createRoot>, container: HTMLDivElement
function event(name: string, payload: unknown) {
  mocks.listeners.get(name)?.({ payload })
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const theme = { ...BUILTIN_THEMES[0], resolution: { width: 1, height: 1 } }
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  mocks.listeners.clear()
  mocks.pixel = 0
  mocks.active = false
  mocks.render.mockReset().mockImplementation(() => {
    mocks.pixel++
  })
  mocks.invoke.mockReset().mockImplementation((command: string) => {
    if (command === "get_ndi_status")
      return Promise.resolve(
        mocks.active
          ? {
              active: true,
              width: 1,
              height: 1,
              fps: 24,
              generation: "1",
              frameProtocol: 1,
              stats: { epoch: 0 },
            }
          : null
      )
    if (command === "begin_ndi_renderer")
      return Promise.resolve({ lease: "1:1", width: 1, height: 1, fps: 24 })
    return Promise.resolve()
  })
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({
          data: new Uint8ClampedArray([mocks.pixel, 0, 0, 255]),
        }),
      }) as unknown as CanvasRenderingContext2D
  )
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BroadcastCanvas />)
    await settle()
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe("mounted binary output delivery", () => {
  it("flushes the newest clear immediately after a slow frame without resending unchanged IPC pixels", async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const normal = mocks.invoke.getMockImplementation()!
    let pushes = 0
    mocks.invoke.mockImplementation((command, ...args) =>
      command === "push_ndi_frame" && pushes++ === 0
        ? blocked
        : normal(command, ...args)
    )
    mocks.active = true
    await act(async () => {
      event("broadcast:ndi-config", {
        active: true,
        width: 1,
        height: 1,
        fps: 24,
      })
      await settle()
    })
    await act(async () => {
      event("broadcast:verse-update", {
        theme,
        verse: { reference: "John 3:16", segments: [{ text: "Fixture" }] },
      })
      event("broadcast:verse-update", {
        theme,
        verse: null,
        clearMode: "black",
        trace: { id: "clear-test", acceptedEpochMs: 0 },
      })
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(
      mocks.invoke.mock.calls.filter(([name]) => name === "push_ndi_frame")
    ).toHaveLength(1)
    await act(async () => {
      release()
      await settle()
    })
    const calls = mocks.invoke.mock.calls.filter(
      ([name]) => name === "push_ndi_frame"
    )
    expect(calls).toHaveLength(2)
    expect(calls[1][1]).toBeInstanceOf(Uint8Array)
    expect(calls[1][1][0]).toBe(mocks.pixel)
    expect(calls[1][2].headers["x-rhema-lease"]).toBe("1:1")
    expect(calls[1][2].headers["x-rhema-trace"]).toBe("clear-test")
    expect(calls[1][2].headers["x-rhema-accepted-ms"]).toBe("0")
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(
      mocks.invoke.mock.calls.filter(([name]) => name === "push_ndi_frame")
    ).toHaveLength(2)
    await act(async () => root.render(null))
    expect(vi.getTimerCount()).toBe(0)
  })
  it("cannot reactivate after a late mount-status response follows a stop event", async () => {
    await act(async () => root.render(null))
    let release!: (value: unknown) => void
    const status = new Promise((resolve) => {
      release = resolve
    })
    mocks.invoke.mockImplementation((command) =>
      command === "get_ndi_status" ? status : Promise.resolve()
    )
    await act(async () => {
      root.render(<BroadcastCanvas />)
      await settle()
    })
    await act(async () =>
      event("broadcast:ndi-config", {
        active: false,
        fps: 24,
        width: 1,
        height: 1,
      })
    )
    await act(async () => {
      release({
        active: true,
        width: 1,
        height: 1,
        fps: 24,
        generation: "old",
        frameProtocol: 1,
        stats: { epoch: 0 },
      })
      await settle()
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(
      mocks.invoke.mock.calls.some(
        ([command]) =>
          command === "begin_ndi_renderer" || command === "push_ndi_frame"
      )
    ).toBe(false)
  })
})
