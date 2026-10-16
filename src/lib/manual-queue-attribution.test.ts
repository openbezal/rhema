import { expect, it, vi } from "vitest"
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
import { operatorActions } from "./operator-actions"
import { useBibleStore } from "@/stores/bible-store"
import { useQueueStore } from "@/stores/queue-store"
it("captures the selected row's stable source code instead of a different pending primary selection", () => {
  useQueueStore.getState().clearQueue()
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "BIUO",
    translations: [
      {
        id: 1,
        abbreviation: "BIUO",
        title: "Igbo",
        language: "ig",
        is_downloaded: true,
        is_copyrighted: true,
      },
      {
        id: 9,
        abbreviation: "KJV",
        title: "King James",
        language: "en",
        is_downloaded: true,
        is_copyrighted: false,
      },
    ],
    selectedVerse: {
      id: 662,
      translation_id: 9,
      book_number: 66,
      book_name: "Revelation of John",
      book_abbreviation: "Rev",
      chapter: 1,
      verse: 2,
      text: "Verified source",
    },
  })
  operatorActions.addToQueue()
  expect(useQueueStore.getState().items[0].translation_code).toBe("KJV")
})
