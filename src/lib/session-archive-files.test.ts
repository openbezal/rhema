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
import type { BroadcastTheme } from "@/types"

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

it.each(["archive", "preferences"] as const)(
  "exports %s with saved empty image placeholders from the editor",
  async (format) => {
    const emptyImage = {
      url: "",
      fit: "cover" as const,
      blur: 0,
      brightness: 100,
      tint: null,
    }
    const base: BroadcastTheme = {
      ...BUILTIN_THEMES[0],
      id: "custom",
      builtin: false,
    }
    const plate = { ...base.textBox, image: emptyImage }
    const themes: BroadcastTheme[] = [
      {
        ...base,
        id: "background-inactive",
        background: { ...base.background, type: "solid", image: emptyImage },
      },
      {
        ...base,
        id: "background-active",
        background: { ...base.background, type: "image", image: emptyImage },
      },
      {
        ...base,
        id: "surface-inactive",
        textBox: { ...plate, enabled: false },
      },
      { ...base, id: "surface-active", textBox: { ...plate, enabled: true } },
      {
        ...base,
        id: "verse-surface",
        verseText: { ...base.verseText, surface: { ...plate, enabled: true } },
      },
      {
        ...base,
        id: "reference-surface",
        reference: { ...base.reference, surface: { ...plate, enabled: true } },
      },
      {
        ...base,
        id: "secondary-surface",
        secondaryVerseText: { surface: { ...plate, enabled: true } },
      },
    ]
    useBroadcastStore.setState({ themes })
    native.invoke.mockResolvedValue(true)
    await expect(exportCurrentSession(format, "Sunday")).resolves.toBe(true)
    const exported = JSON.parse(native.invoke.mock.calls[0][1].content)
      .preferences.customThemes
    expect(exported).toHaveLength(7)
    expect(exported[0].background).toMatchObject({
      type: "solid",
      image: emptyImage,
    })
    expect(exported[1].background).toMatchObject({
      type: "image",
      image: emptyImage,
    })
    expect(exported[2].textBox).toMatchObject({
      enabled: false,
      image: emptyImage,
    })
    expect(exported[3].textBox).toMatchObject({
      enabled: true,
      image: emptyImage,
    })
    expect(exported[4].verseText.surface.image).toEqual(emptyImage)
    expect(exported[5].reference.surface.image).toEqual(emptyImage)
    expect(exported[6].secondaryVerseText.surface.image).toEqual(emptyImage)
  }
)

it.each(["javascript:alert(1)", "data:text/html;base64,PGh0bWw+"])(
  "still rejects non-image URL %s",
  async (url) => {
    useBroadcastStore.setState({
      themes: [
        {
          ...BUILTIN_THEMES[0],
          builtin: false,
          background: {
            ...BUILTIN_THEMES[0].background,
            type: "image",
            image: { url, fit: "cover", blur: 0, brightness: 100, tint: null },
          },
        },
      ],
    })
    await expect(
      exportCurrentSession("preferences", "Sunday")
    ).rejects.toThrow()
  }
)
