import { beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import {
  paletteCommands,
  browsePaletteReference,
  setRemoteServerRunning,
} from "./operator-palette"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsDialogStore } from "./settings-dialog"
import { useSettingsStore } from "@/stores/settings-store"
const translation = {
  id: 1,
  abbreviation: "KJV",
  title: "King James Version",
  language: "en",
  is_downloaded: true,
  is_copyrighted: false,
}
const book = {
  id: 43,
  translation_id: 1,
  book_number: 43,
  name: "John",
  abbreviation: "Jn",
  testament: "NT" as const,
}
beforeEach(() => {
  useSettingsStore.setState({ bookDisplayOverrides: [] })
  mocks.invoke.mockReset()
  useBibleStore.setState({
    translations: [translation],
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    books: [book],
    pendingNavigation: null,
  })
  useSettingsDialogStore.setState({ isOpen: false })
  useBroadcastStore.setState({
    isLive: false,
    liveVerse: null,
    liveSourceVerse: null,
  })
})
it("derives discoverable commands and includes installed stable translations/settings/remote verbs", () => {
  const commands = paletteCommands()
  expect(
    commands.some((item) => item.label === "Switch translation to KJV")
  ).toBe(true)
  expect(
    commands.some((item) => item.label === "Open Remote Control settings")
  ).toBe(true)
  for (const label of [
    "Start HTTP server",
    "Stop HTTP server",
    "Start OSC server",
    "Stop OSC server",
  ])
    expect(commands.some((item) => item.label === label)).toBe(true)
  expect(commands.some((item) => /pin/i.test(item.label))).toBe(false)
})
it("switches using fresh stable-code metadata instead of an old runtime id", async () => {
  const command = paletteCommands().find(
    (item) => item.id === "translation:KJV"
  )!
  useBibleStore.setState({ translations: [{ ...translation, id: 10 }] })
  mocks.invoke.mockResolvedValue(undefined)
  await command.run()
  expect(mocks.invoke).toHaveBeenCalledWith("set_active_translation", {
    translationId: 10,
  })
  expect(useBibleStore.getState().activeTranslationId).toBe(10)
})
it("rejects a now missing or ambiguous translation", async () => {
  const command = paletteCommands().find(
    (item) => item.id === "translation:KJV"
  )!
  useBibleStore.setState({ translations: [] })
  await expect(command.run()).rejects.toThrow()
  expect(mocks.invoke).not.toHaveBeenCalled()
})
it("opens a specific Settings section", async () => {
  await paletteCommands()
    .find((item) => item.id === "settings:remote")!
    .run()
  expect(useSettingsDialogStore.getState()).toMatchObject({
    isOpen: true,
    activeSection: "remote",
  })
})
it("browses a complete verified reference without presenting or going on air", async () => {
  mocks.invoke.mockResolvedValue({
    id: 316,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "Verified text",
  })
  await browsePaletteReference("John 3:16")
  expect(useBibleStore.getState().pendingNavigation).toMatchObject({
    bookNumber: 43,
    chapter: 3,
    verse: 16,
  })
  expect(useBroadcastStore.getState().isLive).toBe(false)
  expect(useBroadcastStore.getState().liveVerse).toBeNull()
})

it("resolves the exact custom display name without replacing canonical palette aliases", async () => {
  useSettingsStore
    .getState()
    .setBookDisplayOverrides([
      { translationCode: "KJV", bookNumber: 43, label: "Yohanan" },
    ])
  mocks.invoke.mockResolvedValue({
    id: 316,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "Verified text",
  })
  await browsePaletteReference("Yohanan 3:16")
  expect(useBibleStore.getState().pendingNavigation?.bookNumber).toBe(43)
  await browsePaletteReference("Jn 3:16")
  expect(useBibleStore.getState().pendingNavigation?.bookNumber).toBe(43)
  expect(useBibleStore.getState().books[0].name).toBe("John")
})
it.each(["John 999:1", "J 3:16", "John words", "John 0:2"])(
  "does not navigate an invalid or ambiguous reference: %s",
  async (input) => {
    useBibleStore.setState({
      books: [
        book,
        {
          ...book,
          id: 59,
          book_number: 59,
          name: "James",
          abbreviation: "Jas",
        },
      ],
    })
    mocks.invoke.mockResolvedValue(null)
    await expect(browsePaletteReference(input)).rejects.toThrow()
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  }
)
it("rejects a stale lookup after language selection changes", async () => {
  let finish!: (value: unknown) => void
  mocks.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const task = browsePaletteReference("John 3:16")
  useBibleStore.setState({ activeTranslationId: 2 })
  finish({
    id: 316,
    translation_id: 1,
    book_number: 43,
    chapter: 3,
    verse: 16,
    text: "Old text",
  })
  await task
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
})
it.each(["osc", "http"] as const)(
  "serializes and reconciles %s server commands using native status",
  async (kind) => {
    let running = false
    let port: number | null = null
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === `get_${kind}_status`) return { running, port }
      if (command === `start_${kind}`) {
        running = true
        port = args.port
        return port
      }
      if (command === `stop_${kind}`) {
        running = false
        port = null
      }
    })
    await Promise.all([
      setRemoteServerRunning(kind, true),
      setRemoteServerRunning(kind, true),
    ])
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === `start_${kind}`)
    ).toHaveLength(1)
    await setRemoteServerRunning(kind, false)
    expect(running).toBe(false)
  }
)
it("validates ports and recovers after a native failure", async () => {
  await expect(setRemoteServerRunning("http", true, -1)).rejects.toThrow()
  expect(mocks.invoke).not.toHaveBeenCalled()
  mocks.invoke.mockRejectedValueOnce(new Error("Unavailable"))
  await expect(setRemoteServerRunning("http", true)).rejects.toThrow()
  mocks.invoke
    .mockResolvedValue({ running: false, port: null })
    .mockResolvedValueOnce({ running: false, port: null })
  await setRemoteServerRunning("http", false)
  expect(mocks.invoke).toHaveBeenCalledWith("get_http_status")
})
