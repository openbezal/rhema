import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DetectionResult, Verse } from "@/types"
const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  invoke: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  callbacks: new Map<string, ((event: { payload: unknown }) => void)[]>(),
}))
vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("sonner", () => ({
  toast: { error: mocks.error, warning: mocks.warning, success: mocks.success },
}))
import { connectDetectionSession } from "./detection-session"
import { connectPresentationController } from "./presentation-controller"
import { operatorActions } from "./operator-actions"
import { connectBibleNavigation } from "./bible-navigation"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useDetectionStore } from "@/stores/detection-store"
import { useAudioStore } from "@/stores/audio-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useQueueStore } from "@/stores/queue-store"
import { beginOperatorMaintenance } from "./operator-maintenance"
import { acceptSessionReset } from "./session-revision"
const verse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified primary text",
}
const browsed = {
  ...verse,
  book_number: 1,
  book_name: "Genesis",
  chapter: 1,
  verse: 1,
}
const detection: DetectionResult = {
  book_number: 43,
  book_name: "John",
  chapter: 3,
  verse: 16,
  verse_ref: "John 3:16",
  verse_text: "Candidate text",
  confidence: 0.95,
  source: "direct",
  translation_id: 1,
  translation_code: "KJV",
  score_kind: "reference",
  auto_queued: false,
  transcript_snippet: "John three sixteen",
  is_chapter_only: false,
}
const cleanups: (() => void)[] = []
const disposers: ReturnType<typeof vi.fn>[] = []
function send(event: string, payload: unknown, revision = 0) {
  for (const callback of mocks.callbacks.get(`session:${event}`) ?? [])
    callback({ payload: { revision, payload } })
}
async function connect() {
  const stop = connectDetectionSession()
  cleanups.push(stop)
  await Promise.resolve()
  return stop
}
beforeEach(() => {
  mocks.callbacks.clear()
  disposers.length = 0
  vi.clearAllMocks()
  mocks.listen.mockImplementation((event, callback) => {
    mocks.callbacks.set(event, [
      ...(mocks.callbacks.get(event) ?? []),
      callback,
    ])
    const dispose = vi.fn()
    disposers.push(dispose)
    return Promise.resolve(dispose)
  })
  mocks.invoke.mockImplementation(async (command) =>
    command === "read_operator_session_revision"
      ? 0
      : command === "get_verse"
        ? verse
        : command === "get_chapter"
          ? [verse]
          : null
  )
  useBibleStore.setState({
    ...useBibleStore.getInitialState(),
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "King James Version",
        language: "en",
        is_downloaded: true,
        is_copyrighted: false,
      },
    ],
    books: [
      {
        id: 43,
        translation_id: 1,
        book_number: 43,
        name: "John",
        abbreviation: "Jn",
        testament: "NT",
      },
    ],
    selectedVerse: browsed,
    currentChapter: [browsed],
  })
  useBroadcastStore.setState({
    ...useBroadcastStore.getInitialState(),
    autoLive: false,
  })
  useTranscriptStore.setState(useTranscriptStore.getInitialState())
  useDetectionStore.setState(useDetectionStore.getInitialState())
  useSettingsStore.setState(useSettingsStore.getInitialState())
  useQueueStore.getState().clearQueue()
})
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop())
})
describe("app-owned detection session", () => {
  it("ingests partial/final transcripts and connection status without a panel", async () => {
    await connect()
    send("stt_connected", null)
    send("transcript_partial", { text: "Partial", confidence: 0.7 })
    expect(useTranscriptStore.getState().currentPartial).toBe("Partial")
    send("transcript_final", { text: "Final transcript", confidence: 0.9 })
    expect(useTranscriptStore.getState().segments).toEqual([
      expect.objectContaining({ text: "Final transcript", confidence: 0.9 }),
    ])
    expect(useTranscriptStore.getState().currentPartial).toBe("")
    expect(useTranscriptStore.getState().connectionStatus).toBe("connected")
    send("stt_disconnected", null)
    expect(useTranscriptStore.getState().connectionStatus).toBe("disconnected")
  })
  it("keeps audio meters/source loss and error feedback active without a panel", async () => {
    await connect()
    send("audio_level", { rms: 0.4, peak: 0.7 })
    send("audio_source_lost", null)
    expect(useAudioStore.getState().level.rms).toBe(0.4)
    expect(useAudioStore.getState().sourceLost).toBe(true)
    send("audio_source_recovered", null)
    send("stt_error", "Disconnected")
    expect(useAudioStore.getState().sourceLost).toBe(false)
    expect(useTranscriptStore.getState().connectionStatus).toBe("error")
    expect(mocks.error).toHaveBeenCalled()
  })
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "separates Follow=%s from Auto=%s for detections and reading advances",
    async (follow, auto) => {
      await connect()
      cleanups.push(connectBibleNavigation())
      operatorActions.setFollowDetections(follow)
      operatorActions.setAutoLive(auto)
      send("verse_detections", [detection])
      await vi.waitFor(() =>
        expect(useDetectionStore.getState().detections).toHaveLength(1)
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(
        auto ? verse : null
      )
      expect(useBibleStore.getState().selectedVerse).toEqual(
        follow ? verse : browsed
      )
      expect(useBibleStore.getState().revealRequest).toBe(follow ? 1 : 0)
      if (!follow)
        expect(useBibleStore.getState().currentChapter).toEqual([browsed])
      send("reading_mode_verse", {
        ...detection,
        reference: detection.verse_ref,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(useBibleStore.getState().selectedVerse).toEqual(
        follow ? verse : browsed
      )
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(
        auto ? verse : null
      )
      expect(useQueueStore.getState().items).toHaveLength(0)
    }
  )
  it.each([false, true])(
    "does not move preview after Follow cancellation (reenabled=%s)",
    async (reenabled) => {
      let finish!: (verse: Verse) => void
      const pending = new Promise<Verse>((resolve) => {
        finish = resolve
      })
      mocks.invoke.mockImplementation(async (command) =>
        command === "get_verse"
          ? pending
          : command === "get_chapter"
            ? pending.then((value) => [value])
            : null
      )
      await connect()
      cleanups.push(connectBibleNavigation(), connectPresentationController())
      operatorActions.setFollowDetections(true)
      operatorActions.setAutoLive(true)
      send("verse_detections", [detection])
      operatorActions.setFollowDetections(false)
      if (reenabled) operatorActions.setFollowDetections(true)
      finish(verse)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(useBibleStore.getState().selectedVerse).toEqual(browsed)
      expect(useBibleStore.getState().revealRequest).toBe(0)
      expect(useBroadcastStore.getState().liveSourceVerse).toEqual(verse)
    }
  )
  it("does not restore a pending automatic verse after Auto is disabled and reenabled", async () => {
    let finish!: (verse: Verse) => void
    mocks.invoke.mockImplementation((command) =>
      command === "get_verse"
        ? new Promise<Verse>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(null)
    )
    await connect()
    cleanups.push(connectPresentationController())
    operatorActions.setAutoLive(true)
    send("verse_detections", [detection])
    operatorActions.setAutoLive(false)
    operatorActions.setAutoLive(true)
    finish(verse)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  })
  it("keeps dismissed and chapter-only candidates out of auto presentation", async () => {
    await connect()
    operatorActions.setAutoLive(true)
    useDetectionStore.getState().dismissDetection(detection.verse_ref, "direct")
    send("verse_detections", [
      detection,
      { ...detection, verse_ref: "John 4", chapter: 4, is_chapter_only: true },
    ])
    await Promise.resolve()
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
  })
  it("queues/refines high-confidence candidates once while reading advances never queue", async () => {
    await connect()
    send("verse_detections", [
      {
        ...detection,
        verse_ref: "John 3",
        verse: 1,
        auto_queued: true,
        is_chapter_only: true,
      },
    ])
    send("verse_detections", [{ ...detection, auto_queued: true }])
    send("verse_detections", [{ ...detection, auto_queued: true }])
    expect(useQueueStore.getState().items).toHaveLength(1)
    expect(useQueueStore.getState().items[0].verse.verse).toBe(16)
    expect(useQueueStore.getState().items[0].is_chapter_only).toBe(false)
  })
  it("shares subscriptions across leases and releases each exactly once", async () => {
    const first = await connect()
    const count = mocks.listen.mock.calls.length
    const second = await connect()
    expect(count).toBeGreaterThan(5)
    expect(mocks.listen).toHaveBeenCalledTimes(count)
    first()
    first()
    send("transcript_final", { text: "Once", confidence: 1 })
    expect(useTranscriptStore.getState().segments).toHaveLength(1)
    expect(disposers.every((dispose) => dispose.mock.calls.length === 0)).toBe(
      true
    )
    second()
    second()
    expect(disposers.every((dispose) => dispose.mock.calls.length === 1)).toBe(
      true
    )
    send("transcript_final", { text: "Late", confidence: 1 })
    expect(useTranscriptStore.getState().segments).toHaveLength(1)
  })
  it("disposes late registrations and ignores old callbacks after StrictMode remount", async () => {
    let resolve!: (stop: () => void) => void
    mocks.listen.mockImplementationOnce((event, callback) => {
      mocks.callbacks.set(event, [callback])
      return new Promise<() => void>((done) => {
        resolve = done
      })
    })
    const stop = await connect()
    const old = mocks.callbacks.get("session:audio_level")?.[0]
    stop()
    await connect()
    const late = vi.fn()
    resolve(late)
    await Promise.resolve()
    expect(late).toHaveBeenCalledOnce()
    useAudioStore.getState().setLevel({ rms: 0, peak: 0 })
    old?.({ payload: { rms: 1, peak: 1 } })
    expect(useAudioStore.getState().level.rms).toBe(0)
  })
  it("keeps other listeners after one subscription fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.listen.mockRejectedValueOnce(new Error("Unavailable"))
    try {
      await connect()
      send("transcript_final", { text: "Still active", confidence: 1 })
      expect(useTranscriptStore.getState().segments).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })
  it("preserves backend text attribution when a delayed packet arrives after a translation switch", async () => {
    await connect()
    useBibleStore.setState({
      activeTranslationId: 2,
      activeTranslationCode: "ESV",
    })
    send("verse_detections", [{ ...detection, auto_queued: true }])
    expect(useQueueStore.getState().items[0]).toMatchObject({
      translation_code: "KJV",
      verse: { translation_id: 1, text: "Candidate text" },
    })
  })
  it("does not auto-queue packets with unresolved translation attribution", async () => {
    await connect()
    send("verse_detections", [
      {
        ...detection,
        translation_id: null,
        translation_code: null,
        auto_queued: true,
      },
    ])
    expect(useQueueStore.getState().items).toEqual([])
  })
  it("bounds hidden-panel history immediately when configuration changes", async () => {
    await connect()
    send(
      "verse_detections",
      Array.from({ length: 10 }, (_, index) => ({
        ...detection,
        source: "semantic",
        score_kind: "fts_rank",
        verse: index + 1,
        verse_ref: `John 3:${index + 1}`,
      }))
    )
    expect(useDetectionStore.getState().suggestions).toHaveLength(10)
    useSettingsStore.getState().setSuggestionCapacity(3)
    expect(useDetectionStore.getState().suggestions).toHaveLength(3)
  })
})

it("pauses shared ingestion and keeps queued old callbacks canceled after maintenance", async () => {
  await connect()
  await connect()
  const old = mocks.callbacks.get("session:transcript_final")![0]
  const oldDetections = mocks.callbacks.get("session:verse_detections")![0]
  const lease = beginOperatorMaintenance()
  try {
    old({ payload: { text: "obsolete", confidence: 1 } })
    oldDetections({ payload: [{ ...detection, auto_queued: true }] })
    expect(useTranscriptStore.getState().segments).toHaveLength(0)
    expect(useQueueStore.getState().items).toHaveLength(0)
    lease.release()
    await Promise.resolve()
    old({ payload: { text: "still obsolete", confidence: 1 } })
    send("transcript_final", { text: "new generation", confidence: 1 })
    expect(
      useTranscriptStore.getState().segments.map((segment) => segment.text)
    ).toEqual(["new generation"])
    expect(mocks.callbacks.get("session:transcript_final")).toHaveLength(2)
  } finally {
    lease.release()
  }
})

it("rejects an old native packet delivered to the new listener after an acknowledged reset", async () => {
  await connect()
  const lease = beginOperatorMaintenance()
  acceptSessionReset(0, 1)
  lease.release()
  await Promise.resolve()
  send("transcript_final", { text: "old queued transcript", confidence: 1 }, 0)
  send("transcript_partial", { text: "old partial", confidence: 1 }, 0)
  send("verse_detections", [{ ...detection, auto_queued: true }], 0)
  send(
    "reading_mode_verse",
    { ...detection, reference: detection.verse_ref },
    0
  )
  send("translation_command", { translation_id: 2, abbreviation: "ESV" }, 0)
  send("stt_error", "old failure", 0)
  expect(useTranscriptStore.getState().segments).toEqual([])
  expect(useTranscriptStore.getState().currentPartial).toBe("")
  expect(useDetectionStore.getState().detections).toEqual([])
  expect(useQueueStore.getState().items).toEqual([])
  expect(useBibleStore.getState().selectedVerse).toBe(browsed)
  expect(mocks.error).not.toHaveBeenCalled()
  send(
    "transcript_final",
    { text: "new acknowledged session", confidence: 1 },
    1
  )
  expect(
    useTranscriptStore.getState().segments.map((item) => item.text)
  ).toEqual(["new acknowledged session"])
})
