import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Verse } from "@/types"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ emitTo: mocks.emit }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
import {
  presentVerse,
  refreshLiveVerse,
  invalidatePresentation,
  connectPresentationController,
} from "./presentation-controller"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { formatVerseReference } from "./verse-reference"
const primary: Verse = {
  id: 16,
  translation_id: 2,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified primary text",
}
const secondary: Verse = {
  ...primary,
  id: 116,
  translation_id: 1,
  text: "Verified optional text",
}
const held = { reference: "Held", segments: [{ text: "Previous live text" }] }
let disconnect: (() => void) | undefined
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
beforeEach(() => {
  invalidatePresentation()
  mocks.invoke.mockReset()
  mocks.emit.mockClear()
  useBibleStore.setState({
    activeTranslationId: 2,
    activeTranslationCode: "ESV",
    secondaryTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    selectedVerse: null,
    translations: [1, 2].map((id) => ({
      id,
      abbreviation: id === 1 ? "KJV" : "ESV",
      title: "Fixture",
      language: "en",
      is_downloaded: true,
      is_copyrighted: false,
    })),
  })
  useBroadcastStore.setState({
    presentationRecovery: "ready",
    outputStatus: {},
    liveVerse: held,
    liveSourceVerse: null,
    isLive: true,
    autoLive: false,
  })
})
afterEach(() => {
  disconnect?.()
  disconnect = undefined
  invalidatePresentation()
})
it("commits primary without waiting for optional text, then attaches matching secondary", async () => {
  const optional = deferred<Verse>()
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 2 ? Promise.resolve(primary) : optional.promise
  )
  const task = presentVerse(primary)
  await settle()
  expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
    primary.text
  )
  expect(mocks.invoke).toHaveBeenCalledWith(
    "get_verse",
    expect.objectContaining({ translationId: 1 })
  )
  optional.resolve(secondary)
  await task
  expect(
    useBroadcastStore.getState().liveVerse?.secondary?.segments[0].text
  ).toBe(secondary.text)
})
it("keeps successful primary text when optional lookup rejects", async () => {
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 2
      ? Promise.resolve(primary)
      : Promise.reject(new Error("Optional unavailable"))
  )
  await presentVerse(primary)
  expect(mocks.invoke).toHaveBeenCalledWith(
    "get_verse",
    expect.objectContaining({ translationId: 1 })
  )
  expect(useBroadcastStore.getState().liveVerse).toMatchObject({
    segments: [{ text: primary.text }],
  })
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
})
it("invalidates the first pending selection snapshot when secondary is disabled", async () => {
  const old = deferred<Verse>(),
    fresh = deferred<Verse>(),
    optional = deferred<Verse>()
  let calls = 0
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 1
      ? optional.promise
      : ++calls === 1
        ? old.promise
        : fresh.promise
  )
  disconnect = connectPresentationController()
  const task = presentVerse(primary)
  useBibleStore.getState().setSecondaryTranslation(null)
  old.resolve(primary)
  await settle()
  expect(useBroadcastStore.getState().liveVerse).toEqual(held)
  fresh.resolve(primary)
  await settle()
  optional.resolve(secondary)
  await task
  expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
    primary.text
  )
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
})
it("cannot attach an old refresh after a newer reference is presented", async () => {
  const optional = deferred<Verse>(),
    newer = { ...primary, verse: 17, text: "New primary" }
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 2
      ? Promise.resolve(args.verse === 16 ? primary : newer)
      : args.verse === 16
        ? optional.promise
        : Promise.resolve({ ...secondary, verse: 17, text: "New optional" })
  )
  useBroadcastStore.setState({ liveSourceVerse: primary })
  const old = refreshLiveVerse()
  await settle()
  await presentVerse(newer)
  optional.resolve(secondary)
  await old
  expect(useBroadcastStore.getState().liveSourceVerse?.verse).toBe(17)
  expect(
    useBroadcastStore.getState().liveVerse?.secondary?.segments[0].text
  ).toBe("New optional")
})
it.each([
  { ...secondary, verse: 17 },
  { ...secondary, translation_id: 2 },
  null,
])("rejects mismatched or missing optional rows: %j", async (row) => {
  mocks.invoke.mockImplementation((_command, args) =>
    Promise.resolve(args.translationId === 2 ? primary : row)
  )
  await presentVerse(primary)
  expect(mocks.invoke).toHaveBeenCalledWith(
    "get_verse",
    expect.objectContaining({ translationId: 1 })
  )
  expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
    primary.text
  )
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
})
it("does not resurrect disabled optional text after primary has already committed", async () => {
  const optional = deferred<Verse>()
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 2 ? Promise.resolve(primary) : optional.promise
  )
  disconnect = connectPresentationController()
  const task = presentVerse(primary)
  await settle()
  useBibleStore.getState().setSecondaryTranslation(null)
  await settle()
  optional.resolve(secondary)
  await task
  expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
    primary.text
  )
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
})
it("removes an already displayed secondary immediately without waiting for a fresh primary lookup", async () => {
  mocks.invoke.mockImplementation((_command, args) =>
    Promise.resolve(args.translationId === 2 ? primary : secondary)
  )
  disconnect = connectPresentationController()
  await presentVerse(primary)
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeDefined()
  const previous = useBroadcastStore.getState().liveVerse!
  const slow = deferred<Verse>()
  mocks.invoke.mockImplementation(() => slow.promise)
  useBibleStore.getState().setSecondaryTranslation(null)
  expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
  expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
    primary.text
  )
  expect(formatVerseReference(useBroadcastStore.getState().liveVerse!)).toBe(
    "John 3:16 (ESV)"
  )
  expect(
    formatVerseReference(useBroadcastStore.getState().liveVerse!, false)
  ).toBe("John 3 (ESV)")
  expect(previous.address?.secondaryTranslationCode).toBe("KJV")
  expect(previous.secondary?.translationCode).toBe("KJV")
  const emitted = mocks.emit.mock.calls
    .filter((call) => call[1] === "broadcast:verse-update")
    .at(-1)![2].verse
  expect(formatVerseReference(emitted)).toBe("John 3:16 (ESV)")
  expect(formatVerseReference(emitted, false)).toBe("John 3 (ESV)")
  slow.resolve(primary)
  await settle()
})
it.each([null, "reject"])(
  "removes secondary immediately while a different primary is pending and later fails: %j",
  async (failure) => {
    mocks.invoke.mockImplementation((_command, args) =>
      Promise.resolve(args.translationId === 2 ? primary : secondary)
    )
    disconnect = connectPresentationController()
    await presentVerse(primary)
    const replacement = deferred<Verse | null>()
    mocks.invoke.mockImplementation((_command, args) =>
      args.translationId === 3
        ? replacement.promise.then((value) => {
            if (failure === "reject")
              throw new Error("Replacement primary unavailable")
            return value
          })
        : Promise.resolve(secondary)
    )
    useBibleStore.setState({
      translations: [
        ...useBibleStore.getState().translations,
        {
          id: 3,
          abbreviation: "NIV",
          title: "Fixture",
          language: "en",
          is_downloaded: true,
          is_copyrighted: false,
        },
      ],
    })
    useBibleStore.getState().setActiveTranslation(3)
    useBibleStore.getState().setSecondaryTranslation(null)
    expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (ESV)"
    )
    expect(formatVerseReference(useBroadcastStore.getState().liveVerse!)).toBe(
      "John 3:16 (ESV)"
    )
    expect(
      formatVerseReference(useBroadcastStore.getState().liveVerse!, false)
    ).toBe("John 3 (ESV)")
    expect(useBroadcastStore.getState().liveVerse?.segments[0].text).toBe(
      primary.text
    )
    replacement.resolve(null)
    await settle()
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (ESV)"
    )
    expect(useBroadcastStore.getState().liveVerse?.secondary).toBeUndefined()
    expect(formatVerseReference(useBroadcastStore.getState().liveVerse!)).toBe(
      "John 3:16 (ESV)"
    )
    expect(
      formatVerseReference(useBroadcastStore.getState().liveVerse!, false)
    ).toBe("John 3 (ESV)")
  }
)
it("does not borrow preview permission from a committed primary awaiting optional text", async () => {
  const optional = deferred<Verse>()
  mocks.invoke.mockImplementation((_command, args) =>
    args.translationId === 2 ? Promise.resolve(primary) : optional.promise
  )
  disconnect = connectPresentationController()
  const task = presentVerse(primary)
  await settle()
  const browsed = { ...primary, id: 17, verse: 17, text: "Browsed verse" }
  useBibleStore.getState().selectVerse(browsed)
  useBibleStore.getState().setSecondaryTranslation(null)
  await settle()
  expect(useBibleStore.getState().selectedVerse).toBe(browsed)
  expect(useBroadcastStore.getState().liveSourceVerse).toEqual(primary)
  optional.resolve(secondary)
  await task
  expect(useBibleStore.getState().selectedVerse).toBe(browsed)
})
