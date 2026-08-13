import { beforeEach, describe, expect, it } from "vitest"
import { useQueueStore } from "./queue-store"
import type { QueueItem } from "@/types"
import type { Verse } from "@/types"

function makeVerse(overrides: Partial<Verse> = {}): Verse {
  return {
    id: 1,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: 16,
    text: "For God so loved the world",
    ...overrides,
  }
}

function makeItem(overrides: Partial<QueueItem> = {}, verse: Partial<Verse> = {}): QueueItem {
  return {
    id: "item-1",
    verse: makeVerse(verse),
    reference: "John 3:16",
    confidence: 1,
    source: "manual",
    added_at: 0,
    ...overrides,
  }
}

beforeEach(() => {
  useQueueStore.setState({ items: [], activeIndex: null, highlightedId: null })
})

describe("addItem", () => {
  it("prepends a new item", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }, { verse: 17 }))

    const items = useQueueStore.getState().items
    expect(items.map((i) => i.id)).toEqual(["b", "a"])
  })

  it("drops an exact duplicate that adds no text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }))

    const items = useQueueStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("a")
  })

  it("backfills text on a duplicate when the existing item has no text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore
      .getState()
      .addItem(makeItem({ id: "b", added_at: 99 }, { text: "For God so loved the world" }))

    const items = useQueueStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("a")
    expect(items[0].added_at).toBe(0)
    expect(items[0].verse.text).toBe("For God so loved the world")
  })

  it("does not overwrite existing text on a duplicate", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "original text" }))
    useQueueStore.getState().addItem(makeItem({ id: "b" }, { text: "different text" }))

    expect(useQueueStore.getState().items[0].verse.text).toBe("original text")
  })
})

describe("backfillText", () => {
  it("fills empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore.getState().backfillText("a", "For God so loved the world")

    expect(useQueueStore.getState().items[0].verse.text).toBe(
      "For God so loved the world",
    )
  })

  it("never overwrites non-empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "original text" }))
    useQueueStore.getState().backfillText("a", "different text")

    expect(useQueueStore.getState().items[0].verse.text).toBe("original text")
  })

  it("ignores unknown ids and empty text", () => {
    useQueueStore.getState().addItem(makeItem({ id: "a" }, { text: "" }))
    useQueueStore.getState().backfillText("missing", "text")
    useQueueStore.getState().backfillText("a", "")

    expect(useQueueStore.getState().items[0].verse.text).toBe("")
  })
})
