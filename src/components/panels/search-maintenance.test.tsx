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
import { connectBibleNavigation } from "@/lib/bible-navigation"
import { useBroadcastStore } from "@/stores/broadcast-store"
import type { Verse } from "@/types"
import { useSettingsStore } from "@/stores/settings-store"
import { useQueueStore } from "@/stores/queue-store"

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
async function type(selector: string, value: string, inputType = "insertText") {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }))
  })
}
beforeEach(async () => {
  useQueueStore.getState().clearQueue()
  useSettingsStore.setState({ bookDisplayOverrides: [] })
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
  useBroadcastStore.setState({
    isLive: false,
    autoLive: false,
    liveVerse: null,
    liveSourceVerse: null,
    presentationRecovery: "ready",
  })
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
for (const label of ["John", "Chosen", "John 3", "Love3", "John 3:16"]) {
  for (const route of ["typing", "IME", "Tab", "ArrowRight"] as const) {
    it(`preserves canonical Genesis intent with label ${label} through ${route}`, async () => {
      await act(async () => {
        useBibleStore.setState({
          books: [
            ...useBibleStore.getState().books,
            {
              id: 1,
              translation_id: 1,
              book_number: 1,
              name: "Genesis",
              abbreviation: "Gen",
              testament: "OT",
            },
            {
              id: 19,
              translation_id: 1,
              book_number: 19,
              name: "Psalms",
              abbreviation: "Ps",
              testament: "OT",
            },
          ],
        })
        useSettingsStore
          .getState()
          .setBookDisplayOverrides([
            { translationCode: "KJV", bookNumber: 1, label },
            ...(label === "Chosen"
              ? [{ translationCode: "KJV", bookNumber: 19, label }]
              : []),
          ])
      })
      const input = host.querySelector<HTMLInputElement>(
        '[aria-label="Bible reference search"]'
      )!
      if (route === "IME") {
        await act(async () =>
          input.dispatchEvent(
            new CompositionEvent("compositionstart", { bubbles: true })
          )
        )
        await type('[aria-label="Bible reference search"]', "Gen 2:4")
        expect(useBibleStore.getState().pendingNavigation).toBeNull()
        await act(async () =>
          input.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true })
          )
        )
      } else if (route === "typing") {
        await type('[aria-label="Bible reference search"]', "Gen 2:4")
      } else {
        await type('[aria-label="Bible reference search"]', "Gen")
        await act(async () =>
          input.dispatchEvent(
            new KeyboardEvent("keydown", { key: route, bubbles: true })
          )
        )
        expect(input.value).toBe("Genesis ")
        expect(useBibleStore.getState().pendingNavigation).toMatchObject({
          bookNumber: 1,
          chapter: 1,
          verse: 1,
        })
        await type('[aria-label="Bible reference search"]', "Gen 2")
        await act(async () =>
          input.dispatchEvent(
            new KeyboardEvent("keydown", { key: route, bubbles: true })
          )
        )
        expect(input.value).toBe("Genesis 2:")
        expect(useBibleStore.getState().pendingNavigation).toBeNull()
        await type('[aria-label="Bible reference search"]', "Gen 2:4")
      }
      expect(useBibleStore.getState().pendingNavigation).toMatchObject({
        bookNumber: 1,
        chapter: 2,
        verse: 4,
      })
      await act(async () =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        )
      )
      expect(useBibleStore.getState().pendingNavigation).toMatchObject({
        bookNumber: 1,
        chapter: 2,
        verse: 4,
        present: true,
      })
    })
  }
}
it("hides an old context row at an edition change and rejects its retained action", async () => {
  await act(async () => {
    useQueueStore.getState().clearQueue()
    useBibleStore.setState({
      translations: [
        ...useBibleStore.getState().translations,
        {
          id: 2,
          abbreviation: "ESV",
          title: "ESV",
          language: "en",
          is_downloaded: true,
          is_copyrighted: false,
        },
      ],
    })
    useSettingsStore.getState().setBookDisplayOverrides([
      { translationCode: "KJV", bookNumber: 43, label: "KJV John" },
      { translationCode: "ESV", bookNumber: 43, label: "ESV John" },
    ])
  })
  await click("Context search")
  await type('input[placeholder="Search verse text..."]', "love mercy")
  await act(async () =>
    useBibleStore.getState().setSemanticResults([oldResult])
  )
  const row = host.querySelector<HTMLElement>(
    '[data-operator-item="context-43:3:16"]'
  )!
  expect(row.getAttribute("aria-label")).toBe("KJV John 3:16")
  const add = row.querySelector<HTMLButtonElement>("button")!
  // Exercise the retained callbacks before React has removed the old DOM row.
  await act(async () => {
    useBibleStore.getState().setActiveTranslation(2)
    add.click()
    row.click()
  })
  expect(useQueueStore.getState().items).toEqual([])
  expect(useBibleStore.getState().selectedVerse).toBe(oldVerse)
  expect(
    host.querySelector('[data-operator-item="context-43:3:16"]')
  ).toBeNull()
  const esvResult = { ...oldResult, verse_text: "Verified ESV context" }
  await act(async () =>
    useBibleStore.getState().setSemanticResults([esvResult])
  )
  const newRow = host.querySelector<HTMLElement>(
    '[data-operator-item="context-43:3:16"]'
  )!
  expect(newRow.getAttribute("aria-label")).toBe("ESV John 3:16")
  await act(async () =>
    newRow.querySelector<HTMLButtonElement>("button")!.click()
  )
  expect(useQueueStore.getState().items[0]).toMatchObject({
    verse: { translation_id: 2, text: "Verified ESV context" },
    translation_code: "ESV",
  })
})
it("uses a display alias for typed navigation without replaying it after a later label change", async () => {
  await act(async () =>
    useSettingsStore
      .getState()
      .setBookDisplayOverrides([
        { translationCode: "KJV", bookNumber: 43, label: "Yohanan" },
      ])
  )
  await type('input[aria-label="Bible reference search"]', "Yohanan 3:17")
  expect(useBibleStore.getState().pendingNavigation).toMatchObject({
    bookNumber: 43,
    chapter: 3,
    verse: 17,
  })
  const newer = { ...oldVerse, verse: 18 }
  await act(async () => {
    useBibleStore.setState({ pendingNavigation: null, selectedVerse: newer })
    useSettingsStore
      .getState()
      .setBookDisplayOverrides([
        { translationCode: "KJV", bookNumber: 43, label: "Yohane" },
      ])
  })
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
  expect(useBibleStore.getState().selectedVerse).toBe(newer)
  expect(useBibleStore.getState().books[0].name).toBe("John")
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

it("does not replay retained typed input after a manual selection and language/catalog change", async () => {
  await type('[aria-label="Bible reference search"]', "John 3:16")
  const selected = {
    ...oldVerse,
    id: 18,
    verse: 18,
    text: "New manual preview",
    translation_id: 2,
  }
  await act(async () => {
    useBibleStore.setState({
      activeTranslationId: 2,
      activeTranslationCode: "ESV",
      books: useBibleStore
        .getState()
        .books.map((book) => ({ ...book, translation_id: 2 })),
      selectedVerse: selected,
      currentChapter: [selected],
      pendingNavigation: null,
    })
  })
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
  expect(useBibleStore.getState().selectedVerse).toBe(selected)
  expect(
    host.querySelector<HTMLInputElement>(
      '[aria-label="Bible reference search"]'
    )?.value
  ).toBe("John 3:16")
})
async function addJamesAndJude() {
  await act(async () => {
    useBibleStore.setState({
      books: [
        ...useBibleStore.getState().books,
        {
          id: 59,
          translation_id: 1,
          book_number: 59,
          name: "James",
          abbreviation: "Jas",
          testament: "NT",
        },
        {
          id: 65,
          translation_id: 1,
          book_number: 65,
          name: "Jude",
          abbreviation: "Jud",
          testament: "NT",
        },
      ],
    })
  })
}
it.each([false, true])(
  "rejects retained Bible row and Queue controls across reset, including busy render=%s",
  async (busyRender) => {
    let lease: ReturnType<typeof beginOperatorMaintenance> | undefined
    if (busyRender)
      await act(async () => {
        lease = beginOperatorMaintenance()
      })
    const row = host.querySelector<HTMLElement>(
      '[data-operator-item="verse-1"]'
    )!
    const add = row.querySelector<HTMLButtonElement>("button")!
    await act(async () => {
      lease ??= beginOperatorMaintenance()
      useBibleStore.setState({
        selectedVerse: null,
        allowAutomaticPreview: false,
      })
      useQueueStore.getState().clearQueue()
      lease.release()
      row.click()
      add.click()
    })
    expect(useBibleStore.getState().selectedVerse).toBeNull()
    expect(useBroadcastStore.getState().liveVerse).toBeNull()
    expect(useQueueStore.getState().items).toEqual([])
    await act(async () =>
      host.querySelector<HTMLElement>('[data-operator-item="verse-1"]')!.click()
    )
    expect(useBibleStore.getState().selectedVerse).toBe(oldVerse)
  }
)
it("leaves ambiguous J alone and completes JA on a delimiter and JA 2 2 on paste", async () => {
  await addJamesAndJude()
  await type('[aria-label="Bible reference search"]', "J")
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
  await type('[aria-label="Bible reference search"]', "JA ")
  expect(
    host.querySelector<HTMLInputElement>(
      '[aria-label="Bible reference search"]'
    )?.value
  ).toBe("James ")
  await type(
    '[aria-label="Bible reference search"]',
    "JA 2 2",
    "insertFromPaste"
  )
  expect(
    host.querySelector<HTMLInputElement>(
      '[aria-label="Bible reference search"]'
    )?.value
  ).toBe("James 2:2")
  expect(useBibleStore.getState().pendingNavigation).toMatchObject({
    bookNumber: 59,
    chapter: 2,
    verse: 2,
  })
})
it("does not rewrite a deletion or intermediate composition", async () => {
  await addJamesAndJude()
  await type(
    '[aria-label="Bible reference search"]',
    "JA ",
    "deleteContentBackward"
  )
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Bible reference search"]'
  )!
  expect(input.value).toBe("JA ")
  await act(async () => {
    useBibleStore.getState().setPendingNavigation(null)
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true })
    )
  })
  await type('[aria-label="Bible reference search"]', "JA 2 2")
  expect(input.value).toBe("JA 2 2")
  expect(useBibleStore.getState().pendingNavigation).toBeNull()
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true })
    )
  )
  expect(input.value).toBe("James 2:2")
  expect(useBibleStore.getState().pendingNavigation).toMatchObject({
    bookNumber: 59,
    chapter: 2,
    verse: 2,
  })
})
it("retains the newest quick dropdown when an old chapter finishes last", async () => {
  let oldFinish!: (rows: Verse[]) => void, newFinish!: (rows: Verse[]) => void
  mocks.invoke
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldFinish = resolve
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newFinish = resolve
        })
    )
  await type('[aria-label="Bible reference search"]', "John 3:")
  await type('[aria-label="Bible reference search"]', "John 4:")
  await act(async () => {
    newFinish([{ ...oldVerse, chapter: 4, text: "Newest dropdown" }])
    oldFinish([oldVerse])
  })
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Newest dropdown")
    )
  ).toBe(true)
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Old pending verse")
    )
  ).toBe(false)
})
it("hides the previous dropdown while a new chapter request is pending", async () => {
  mocks.invoke.mockResolvedValueOnce([oldVerse])
  await type('[aria-label="Bible reference search"]', "John 3:")
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Old pending verse")
    )
  ).toBe(true)
  mocks.invoke.mockImplementationOnce(() => new Promise(() => {}))
  await type('[aria-label="Bible reference search"]', "John 4:")
  expect(
    [...host.querySelectorAll("button")].some((button) =>
      button.textContent?.includes("Old pending verse")
    )
  ).toBe(false)
})
it("keeps mid-input editing at the operator's caret", async () => {
  await addJamesAndJude()
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Bible reference search"]'
  )!
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, "JA 2 2")
    input.setSelectionRange(1, 1)
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText" })
    )
  })
  expect(input.value).toBe("JA 2 2")
  expect(input.selectionStart).toBe(1)
})
it("drops an old context result immediately when the language changes", async () => {
  let finish!: (rows: unknown[]) => void
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await click("Context search")
  await type('input[placeholder="Search verse text..."]', "pending words")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  const retained = [{ ...oldResult, verse_text: "Current language result" }]
  await act(async () => {
    useBibleStore.setState({
      activeTranslationId: 2,
      semanticResults: retained,
    })
    finish([oldResult])
  })
  expect(useBibleStore.getState().semanticResults).toBe(retained)
})
it("does not show an old context result while a newer query waits for its debounce", async () => {
  let finish!: (rows: unknown[]) => void
  mocks.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await click("Context search")
  await type('input[placeholder="Search verse text..."]', "pending words")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
  await type('input[placeholder="Search verse text..."]', "newer query")
  await act(async () => finish([oldResult]))
  expect(useBibleStore.getState().semanticResults).toEqual([])
})

it("cancels handed-off quick navigation when the input is cleared before loading finishes", async () => {
  let finish!: (rows: Verse[]) => void
  mocks.invoke.mockImplementation((command) =>
    command === "get_chapter"
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(undefined)
  )
  const stop = connectBibleNavigation()
  try {
    await type('[aria-label="Bible reference search"]', "John 4:16")
    await type('[aria-label="Bible reference search"]', "")
    await act(async () => finish([{ ...oldVerse, chapter: 4 }]))
    expect(useBibleStore.getState().selectedVerse).toBe(oldVerse)
    expect(useBibleStore.getState().currentChapter).toEqual([oldVerse])
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  } finally {
    stop()
  }
})
it("cancels handed-off quick navigation when a newer manual row is selected", async () => {
  let finish!: (rows: Verse[]) => void
  mocks.invoke.mockImplementation((command) =>
    command === "get_chapter"
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(null)
  )
  const manual = { ...oldVerse, id: 18, verse: 18 }
  await act(async () =>
    useBibleStore.getState().setCurrentChapter([oldVerse, manual])
  )
  const stop = connectBibleNavigation()
  try {
    await type('[aria-label="Bible reference search"]', "John 3:16")
    await act(async () =>
      host.querySelector<HTMLElement>('[aria-label="John 3:18"]')!.click()
    )
    await act(async () => finish([oldVerse]))
    expect(useBibleStore.getState().selectedVerse).toBe(manual)
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  } finally {
    stop()
  }
})
it("does not restart handed-off typed navigation under a different translation", async () => {
  mocks.invoke.mockImplementation(() => new Promise(() => {}))
  const stop = connectBibleNavigation()
  try {
    await type('[aria-label="Bible reference search"]', "John 4:16")
    await act(async () => useBibleStore.setState({ activeTranslationId: 2 }))
    expect(mocks.invoke).toHaveBeenCalledWith("get_chapter", {
      translationId: 1,
      bookNumber: 43,
      chapter: 4,
    })
    expect(mocks.invoke).not.toHaveBeenCalledWith("get_chapter", {
      translationId: 2,
      bookNumber: 43,
      chapter: 4,
    })
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  } finally {
    stop()
  }
})
it("retains an unrelated app-owned navigation when quick input is cleared", async () => {
  await type('[aria-label="Bible reference search"]', "John 3:16")
  const other = { bookNumber: 43, chapter: 5, verse: 1, follow: true }
  await act(async () => useBibleStore.getState().setPendingNavigation(other))
  await type('[aria-label="Bible reference search"]', "")
  expect(useBibleStore.getState().pendingNavigation).toBe(other)
})
it("preserves explicit Enter navigation after it clears the input", async () => {
  mocks.invoke.mockImplementation(async (command) =>
    command === "get_chapter" ? [oldVerse] : oldVerse
  )
  await type('[aria-label="Bible reference search"]', "John 3:16")
  const stop = connectBibleNavigation()
  try {
    await act(async () =>
      host
        .querySelector<HTMLInputElement>(
          '[aria-label="Bible reference search"]'
        )!
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          })
        )
    )
    expect(
      host.querySelector<HTMLInputElement>(
        '[aria-label="Bible reference search"]'
      )?.value
    ).toBe("")
    expect(useBibleStore.getState().selectedVerse?.verse).toBe(16)
    expect(useBroadcastStore.getState().liveVerse?.reference).toBe(
      "John 3:16 (KJV)"
    )
    expect(useBibleStore.getState().pendingNavigation).toBeNull()
  } finally {
    stop()
  }
})
it("keeps the text and caret when composition commits in the middle", async () => {
  await addJamesAndJude()
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Bible reference search"]'
  )!
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true })
    )
  )
  await type('[aria-label="Bible reference search"]', "JA 2 2")
  await act(async () => {
    input.setSelectionRange(1, 1)
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true })
    )
  })
  expect(input.value).toBe("JA 2 2")
  expect(input.selectionStart).toBe(1)
})
