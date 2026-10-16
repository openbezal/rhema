import { beforeEach, describe, expect, it, vi } from "vitest"
import { queueSuggestion, presentSuggestion } from "./suggestion-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
import type { SuggestionCandidate } from "./suggestion-history"
import {
  beginOperatorMaintenance,
  operatorRevision,
} from "./operator-maintenance"
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  present: vi.fn(),
  info: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("./presentation-controller", () => ({
  presentPrimaryVerse: mocks.present,
}))
vi.mock("sonner", () => ({ toast: { info: mocks.info } }))
const candidate: SuggestionCandidate = {
  book_number: 43,
  book_name: "John",
  chapter: 3,
  verse: 16,
  verse_ref: "John 3:16",
  verse_text: "Cached text",
  source: "semantic",
  confidence: 0.75,
  auto_queued: false,
  transcript_snippet: "Fixture quote",
  is_chapter_only: false,
  translation_code: "KJV",
  translation_id: 1,
  score_kind: "fts_rank",
  firstSeenAt: 0,
  lastSeenAt: 0,
}
const row = {
  id: 100,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Verified KJV text",
}
describe("explicit suggestion actions", () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.present.mockReset()
    mocks.info.mockReset()
    useQueueStore.getState().clearQueue()
    useBibleStore.setState({
      activeTranslationId: 2,
      activeTranslationCode: "ESV",
      translations: [
        {
          id: 1,
          abbreviation: "KJV",
          title: "King James",
          language: "en",
          is_downloaded: true,
          is_copyrighted: false,
        },
        {
          id: 2,
          abbreviation: "ESV",
          title: "English Standard",
          language: "en",
          is_downloaded: true,
          is_copyrighted: true,
        },
      ],
    })
    mocks.invoke.mockResolvedValue(row)
  })
  it("queues verified text in the candidate's source translation", async () => {
    await queueSuggestion(candidate)
    expect(mocks.invoke).toHaveBeenCalledWith("get_verse", {
      translationId: 1,
      bookNumber: 43,
      chapter: 3,
      verse: 16,
    })
    expect(useQueueStore.getState().items[0]).toMatchObject({
      translation_code: "KJV",
      verse: { translation_id: 1, text: "Verified KJV text" },
    })
  })
  it.each(["during", "after"] as const)(
    "drops a Queue lookup completed %s session maintenance",
    async (phase) => {
      let finish!: (value: typeof row) => void
      mocks.invoke.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const pending = queueSuggestion(candidate)
      const lease = beginOperatorMaintenance()
      try {
        if (phase === "after") lease.release()
        finish(row)
        await expect(pending).resolves.toBe(false)
        expect(useQueueStore.getState().items).toEqual([])
        expect(mocks.info).not.toHaveBeenCalled()
      } finally {
        lease.release()
      }
    }
  )
  it("refuses actions from an earlier rendered session after maintenance has ended", async () => {
    const origin = operatorRevision(),
      lease = beginOperatorMaintenance()
    lease.release()
    await expect(queueSuggestion(candidate, origin)).resolves.toBe(false)
    await presentSuggestion(candidate, origin)
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.present).not.toHaveBeenCalled()
  })
  it("looks up stable code after numeric IDs change", async () => {
    useBibleStore.getState().setTranslations([
      {
        id: 9,
        abbreviation: "KJV",
        title: "King James",
        language: "en",
        is_downloaded: true,
        is_copyrighted: false,
      },
    ])
    mocks.invoke.mockResolvedValue({ ...row, translation_id: 9 })
    await queueSuggestion(candidate)
    expect(useQueueStore.getState().items[0].verse.translation_id).toBe(9)
  })
  it.each([
    null,
    { ...row, translation_id: 2 },
    { ...row, verse: 17 },
    { ...row, text: " " },
  ])("holds queue on missing or mismatched lookup %#", async (result) => {
    mocks.invoke.mockResolvedValue(result)
    await expect(queueSuggestion(candidate)).rejects.toThrow()
    expect(useQueueStore.getState().items).toEqual([])
  })
  it("rejects unknown attribution before native lookup", async () => {
    await expect(
      queueSuggestion({
        ...candidate,
        translation_code: "UNKNOWN",
        translation_id: 0,
      })
    ).rejects.toThrow()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it("presents only on explicit action through the primary presentation controller", async () => {
    await presentSuggestion(candidate)
    expect(mocks.present).toHaveBeenCalledWith(
      expect.objectContaining({ book_number: 43, chapter: 3, verse: 16 })
    )
    expect(useQueueStore.getState().items).toEqual([])
  })
  it("preserves a direct candidate's source when shared queue controls use it", async () => {
    await queueSuggestion({
      ...candidate,
      source: "direct",
      score_kind: "reference",
    })
    expect(useQueueStore.getState().items[0].source).toBe("ai-direct")
  })
})
