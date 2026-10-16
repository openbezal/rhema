import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), recovery: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("./session-reset-controller", () => ({
  getSessionResetRecoveryArchive: mocks.recovery,
}))
import { exportBeforeNewSession } from "./session-reset-files"
import { captureSessionArchive } from "./session-archive"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useSettingsStore } from "@/stores/settings-store"
beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(true)
  mocks.recovery.mockReset().mockReturnValue(null)
  useSettingsStore.setState({ deepgramApiKey: "FAKE-LOCAL-EXCLUDED" })
  useTranscriptStore.setState({
    segments: [
      {
        id: "old",
        text: "Captured before reset — Ọlọ́run",
        timestamp: 1,
        is_final: true,
        confidence: 1,
        words: [],
      },
    ],
    currentPartial: "UNFINISHED",
  })
})
it.each(["archive", "transcript"] as const)(
  "exports immutable pre-reset %s after active stores have been cleared",
  async (format) => {
    const captured = captureSessionArchive("Before reset")
    mocks.recovery.mockReturnValue(captured)
    useTranscriptStore.getState().clearTranscript()
    await expect(exportBeforeNewSession(format)).resolves.toBe(true)
    const [command, args] = mocks.invoke.mock.calls[0]
    expect(command).toBe("save_export_document")
    expect(args.content).toContain("Captured before reset — Ọlọ́run")
    expect(args.content).not.toContain("UNFINISHED")
    expect(args.content).not.toContain("FAKE-LOCAL-EXCLUDED")
  }
)
