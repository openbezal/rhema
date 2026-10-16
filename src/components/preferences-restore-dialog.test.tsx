// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ apply: vi.fn(), invoke: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/preference-restore-controller", async (original) => ({
  ...(await original<typeof import("@/lib/preference-restore-controller")>()),
  applyPreferencesRestore: mocks.apply,
}))
import { PreferencesRestoreDialog } from "./preferences-restore-dialog"
import { BUILTIN_THEMES } from "@/lib/builtin-themes"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import {
  beginOperatorMaintenance,
  useOperatorMaintenanceStore,
} from "@/lib/operator-maintenance"
const preferences = {
  settings: {
    gain: 1.8,
    autoMode: false,
    confidenceThreshold: 0.85,
    cooldownMs: 2000,
    suggestionCapacity: 40,
    suggestionRetentionMs: 90000,
    sttProvider: "whisper" as const,
  },
  primaryTranslationCode: "BIUO",
  secondaryTranslationCode: null,
  followDetections: true,
  autoLive: false,
  customThemes: [
    {
      ...BUILTIN_THEMES[0],
      id: "source",
      name: "Imported Chineke",
      builtin: false,
    },
  ],
}
const catalog = [
  {
    id: 7,
    abbreviation: "KJV",
    title: "King James",
    language: "en",
    is_downloaded: true,
    is_copyrighted: false,
  },
  {
    id: 10,
    abbreviation: "BIUO",
    title: "Igbo",
    language: "ig",
    is_downloaded: true,
    is_copyrighted: true,
  },
]
let root: Root
let host: HTMLDivElement
function button(text: string) {
  const result = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === text)
  if (!result) throw new Error(`Missing button ${text}`)
  return result
}
async function click(text: string) {
  await act(async () => {
    button(text).click()
  })
}
async function change(label: string, value: string) {
  await act(async () => {
    const select = document.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`
    )!
    select.value = value
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  sessionStorage.clear()
  mocks.apply.mockReset().mockResolvedValue(undefined)
  mocks.invoke.mockReset().mockResolvedValue(true)
  useOperatorMaintenanceStore.setState({
    phase: "idle",
    revision: 0,
    message: null,
  })
  useProfileStatusStore.setState({ readFailed: false })
  useBibleStore.setState({
    ...useBibleStore.getInitialState(),
    translations: catalog,
    activeTranslationId: 7,
    activeTranslationCode: "KJV",
  })
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    presentationRecovery: "ready",
    isLive: false,
    isDesignerOpen: false,
  })
  useSettingsStore.setState({
    ...useSettingsStore.getInitialState(),
    deepgramApiKey: "FAKE-LOCAL",
    onboardingComplete: true,
  })
  useTranscriptStore.setState({
    ...useTranscriptStore.getInitialState(),
    segments: [
      {
        id: "final",
        text: "Retained recovery words",
        is_final: true,
        confidence: 1,
        timestamp: Date.now(),
        words: [],
      },
    ],
  })
  useQueueStore.setState({
    items: [
      {
        id: "held-queue",
        reference: "John 3:16",
        confidence: 1,
        source: "manual",
        added_at: Date.now(),
        translation_code: "KJV",
        verse: {
          id: 716,
          translation_id: 7,
          book_number: 43,
          book_name: "John",
          book_abbreviation: "Jn",
          chapter: 3,
          verse: 16,
          text: "Held Queue text",
        },
      },
    ],
    activeIndex: 0,
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

it("reviews all portable values without applying and restores focus after Cancel", async () => {
  const applied = vi.fn()
  const source = structuredClone(preferences)
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={source}
        sourceName="Saved Sunday.json"
        onApplied={applied}
      />
    )
  })
  const trigger = button("Review preferences")
  await click("Review preferences")
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "1.8×"
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "90 s"
  )
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Imported Chineke"
  )
  expect(mocks.apply).not.toHaveBeenCalled()
  await click("Cancel")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(source).toEqual(preferences)
  expect(applied).not.toHaveBeenCalled()
})

it("requires explicit mappings for unavailable languages including optional None", async () => {
  const applied = vi.fn()
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={{
          ...preferences,
          primaryTranslationCode: "MISSING",
          secondaryTranslationCode: "OTHER",
        }}
        sourceName="Moved PC.json"
        onApplied={applied}
      />
    )
  })
  await click("Review preferences")
  expect(button("Apply preferences").disabled).toBe(true)
  await change("Primary translation for this computer", "KJV")
  expect(button("Apply preferences").disabled).toBe(true)
  await change("Secondary translation for this computer", "none")
  expect(button("Apply preferences").disabled).toBe(false)
  await click("Apply preferences")
  expect(mocks.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      preferences: expect.objectContaining({
        customThemes: [
          expect.objectContaining({ id: expect.stringMatching(/^import-/) }),
        ],
      }),
    }),
    "KJV",
    null
  )
  expect(applied).toHaveBeenCalledTimes(1)
})

it("keeps the review open after a known failure and prevents closing while a commit is pending", async () => {
  let finish!: () => void
  mocks.apply
    .mockRejectedValueOnce(new Error("Synthetic disk full"))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={preferences}
        sourceName="Saved.json"
        onApplied={() => {}}
      />
    )
  })
  await click("Review preferences")
  await click("Apply preferences")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "disk full"
  )
  expect(
    document
      .querySelector('[role="alert"]')
      ?.closest('[data-slot="dialog-footer"]')
  ).not.toBeNull()
  await click("Apply preferences")
  expect(button("Cancel").disabled).toBe(true)
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
  })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => {
    finish()
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it("explains that Live must be off and keeps apply disabled while it is on", async () => {
  useBroadcastStore.setState({ isLive: true })
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={preferences}
        sourceName="Saved.json"
        onApplied={() => {}}
      />
    )
  })
  await click("Review preferences")
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Turn Live off"
  )
  expect(button("Apply preferences").disabled).toBe(true)
  expect(mocks.apply).not.toHaveBeenCalled()
})

it("keeps success feedback beside the restored review button", async () => {
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={preferences}
        sourceName="Saved.json"
        onApplied={() => {}}
      />
    )
  })
  await click("Review preferences")
  await click("Apply preferences")
  const status = host.querySelector('[role="status"]')
  expect(status?.textContent).toContain("Preferences restored")
  expect(button("Review preferences").parentElement?.contains(status)).toBe(
    true
  )
})

it("offers a current session export before explicit reload when recovery is required", async () => {
  mocks.apply.mockImplementationOnce(async () => {
    const lease = beginOperatorMaintenance()
    lease.recoveryRequired("Reload Rhema before continuing.")
    throw new Error("Reload Rhema before continuing.")
  })
  await act(async () => {
    root.render(
      <PreferencesRestoreDialog
        preferences={preferences}
        sourceName="Saved.json"
        onApplied={() => {}}
      />
    )
  })
  await click("Review preferences")
  await click("Apply preferences")
  expect(button("Cancel").disabled).toBe(true)
  expect(button("Reload Rhema").disabled).toBe(false)
  await click("Export current session")
  expect(mocks.invoke).toHaveBeenCalledWith(
    "save_export_document",
    expect.objectContaining({
      format: "json",
      content: expect.stringContaining("Retained recovery words"),
    })
  )
  const call = mocks.invoke.mock.calls.find(
    ([command]) => command === "save_export_document"
  )!
  expect(call[1].content).not.toContain("FAKE-LOCAL")
  expect(call[1].content).toContain("Held Queue text")
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})
