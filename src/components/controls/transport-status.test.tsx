// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
vi.mock("@/components/theme-provider", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}))
vi.mock("@/components/settings-dialog", () => ({ SettingsDialog: () => null }))
vi.mock("@/components/broadcast/theme-designer", () => ({
  ThemeDesigner: () => null,
}))
vi.mock("@/components/broadcast/broadcast-outputs-dialog", () => ({
  BroadcastOutputsDialog: () => null,
}))
import { TransportBar } from "./transport-bar"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let dispose: (() => void) | undefined
afterEach(() => {
  act(() => dispose?.())
  document.body.innerHTML = ""
})
it.each([
  [false, false],
  [false, true],
  [true, false],
])(
  "identifies transcription explicitly when transcription=%s and broadcast=%s",
  async (transcribing, onAir) => {
    useTranscriptStore.setState({ isTranscribing: transcribing })
    useBroadcastStore.setState({ isLive: onAir })
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    dispose = () => root.unmount()
    await act(async () => root.render(<TransportBar />))
    const status = host.querySelector('[aria-label="Transcription status"]')
    expect(status?.textContent).toBe(
      transcribing ? "TRANSCRIPTION ON" : "TRANSCRIPTION OFF"
    )
    expect(host.textContent).not.toContain("OFF AIR")
  }
)
