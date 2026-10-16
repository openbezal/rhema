import { beforeEach, expect, it, vi } from "vitest"
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import {
  exportCurrentSession,
  openSessionDocument,
} from "./session-archive-files"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useBibleStore } from "@/stores/bible-store"
import { BUILTIN_THEMES } from "./builtin-themes"

beforeEach(() => {
  native.invoke.mockReset()
  useBroadcastStore.setState({ themes: [...BUILTIN_THEMES] })
  useBibleStore.setState({
    activeTranslationCode: "KJV",
    secondaryTranslationCode: null,
  })
  useTranscriptStore.setState({
    segments: [
      {
        id: "1",
        text: "Ọlọ́run",
        timestamp: 1000,
        confidence: 1,
        words: [],
        is_final: true,
      },
    ],
    currentPartial: "partial",
  })
})
it("keeps a click-time snapshot while the native export dialog is open", async () => {
  let release!: (saved: boolean) => void
  native.invoke.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        release = resolve
      })
  )
  const saved = exportCurrentSession("transcript", "Sunday")
  useTranscriptStore.getState().clearTranscript()
  const args = native.invoke.mock.calls[0][1]
  expect(args).toMatchObject({ format: "text", defaultName: "Sunday" })
  expect(args.content).toContain("Ọlọ́run")
  expect(args.content).not.toContain("partial")
  release(true)
  await expect(saved).resolves.toBe(true)
})
it("exports transcript independently of an invalid saved theme", async () => {
  useBroadcastStore.setState({
    themes: [
      {
        ...BUILTIN_THEMES[0],
        builtin: false,
        resolution: { width: -1, height: 1080 },
      },
    ],
  })
  native.invoke.mockResolvedValue(true)
  await expect(exportCurrentSession("transcript", "Sunday")).resolves.toBe(true)
})
it.each([false, true])(
  "returns the native export receipt %s unchanged",
  async (receipt) => {
    native.invoke.mockResolvedValue(receipt)
    await expect(exportCurrentSession("preferences", "Sunday")).resolves.toBe(
      receipt
    )
    const args = native.invoke.mock.calls[0][1]
    expect(JSON.parse(args.content).kind).toBe("rhema-preferences")
  }
)
it("propagates disk errors without reporting a saved archive", async () => {
  native.invoke.mockRejectedValue(new Error("Disk full"))
  await expect(exportCurrentSession("archive", "Sunday")).rejects.toThrow(
    "Disk full"
  )
})
it("cancels an archive read without returning a document", async () => {
  native.invoke.mockResolvedValue(null)
  await expect(openSessionDocument()).resolves.toBeNull()
})
it("rejects an invalid read without changing active stores", async () => {
  const transcript = useTranscriptStore.getState().segments
  const themes = useBroadcastStore.getState().themes
  native.invoke.mockResolvedValue({
    name: "future.json",
    text: '{"kind":"rhema-session-archive","version":99}',
  })
  await expect(openSessionDocument()).rejects.toThrow()
  expect(useTranscriptStore.getState().segments).toBe(transcript)
  expect(useBroadcastStore.getState().themes).toBe(themes)
})
