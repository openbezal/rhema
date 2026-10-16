// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fuse: vi.fn() }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/context-search", () => ({ searchContextWithFuse: mocks.fuse }))
import { SearchPanel } from "./search-panel"
import { useBibleStore } from "@/stores/bible-store"
import { beginOperatorMaintenance } from "@/lib/operator-maintenance"
import type { Verse } from "@/types"

const oldVerse: Verse = {
  id: 1,
  translation_id: 1,
  book_number: 43,
  book_name: "John",
  book_abbreviation: "Jn",
  chapter: 3,
  verse: 16,
  text: "Old pending verse",
}
const oldResult = {
  verse_ref: "John 3:16",
  verse_text: "Old pending context",
  book_number: 43,
  book_name: "John",
  chapter: 3,
  verse: 16,
  similarity: 0.8,
}
let root: Root, host: HTMLDivElement
async function click(text: string) {
  await act(async () => {
    ;[...host.querySelectorAll("button")]
      .find((button) => button.textContent === text)!
      .click()
  })
}
async function type(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  mocks.invoke.mockReset().mockResolvedValue([])
  mocks.fuse.mockReset().mockResolvedValue([])
  useBibleStore.setState({
    activeTranslationId: 1,
    activeTranslationCode: "KJV",
    translationSelectionStatus: "ready",
    translations: [
      {
        id: 1,
        abbreviation: "KJV",
        title: "KJV",
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
    currentChapter: [oldVerse],
    selectedVerse: oldVerse,
    pendingNavigation: null,
    semanticResults: [],
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<SearchPanel />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
for (const phase of ["during", "after"] as const) {
  for (const stage of ["reference", "hybrid", "fallback"] as const) {
    it(`ignores a ${stage} context completion ${phase} maintenance`, async () => {
      let finish!: (value: unknown) => void
      const pending = new Promise((resolve) => {
        finish = resolve
      })
      mocks.invoke.mockImplementation(async (command) =>
        command === (stage === "reference" ? "get_verse" : "semantic_search")
          ? pending
          : []
      )
      if (stage === "fallback") {
        mocks.invoke.mockResolvedValue([])
        mocks.fuse.mockReturnValue(pending)
      }
      await click("Context search")
      await type(
        'input[placeholder="Search verse text..."]',
        stage === "reference" ? "John 3:16" : "pending words"
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      expect(
        stage === "fallback" ? mocks.fuse : mocks.invoke
      ).toHaveBeenCalled()
      let lease!: ReturnType<typeof beginOperatorMaintenance>
      await act(async () => {
        lease = beginOperatorMaintenance()
      })
      const retained = [
        { ...oldResult, verse_text: "Current retained context" },
      ]
      await act(async () => {
        useBibleStore.setState({ semanticResults: retained })
        if (phase === "after") lease.release()
      })
      try {
        await act(async () => {
          finish(stage === "reference" ? oldVerse : [oldResult])
        })
        expect(useBibleStore.getState().semanticResults).toBe(retained)
      } finally {
        await act(async () => lease.release())
      }
    })
  }
}
it("cancels a pending context timer rather than launching old work after maintenance", async () => {
  await click("Context search")
  await type('input[placeholder="Search verse text..."]', "pending words")
  mocks.invoke.mockClear()
  await act(async () => {
    const lease = beginOperatorMaintenance()
    lease.release()
    await vi.advanceTimersByTimeAsync(400)
  })
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "semantic_search",
    expect.anything()
  )
})
it("cancels the pending quick-reference dropdown", async () => {
  let finish!: (rows: Verse[]) => void
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await type('[aria-label="Bible reference search"]', "John 3:")
  await act(async () => {
    const lease = beginOperatorMaintenance()
    useBibleStore.getState().setPendingNavigation(null)
    lease.release()
    finish([oldVerse])
  })
  expect(
    host.querySelector<HTMLInputElement>(
      '[aria-label="Bible reference search"]'
    )?.value
  ).toBe("")
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Old pending verse")
    )
  ).toBe(false)
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
})
it("cancels the old typed navigation intent before the restored catalog arrives", async () => {
  await type('[aria-label="Bible reference search"]', "John 3:16")
  expect(useBibleStore.getState().pendingNavigation).not.toBeNull()
  await act(async () => {
    const lease = beginOperatorMaintenance()
    useBibleStore.getState().setPendingNavigation(null)
    useBibleStore.setState({ books: [...useBibleStore.getState().books] })
    lease.release()
  })
  expect(
    host.querySelector<HTMLInputElement>(
      '[aria-label="Bible reference search"]'
    )?.value
  ).toBe("")
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
})
