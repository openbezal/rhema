// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const action = vi.hoisted(() => ({ present: vi.fn() }))
vi.mock("@/lib/operator-actions", () => ({
  operatorActions: { presentQueueItem: action.present },
}))
import { QueuePanel } from "./queue-panel"
import { useQueueStore } from "@/stores/queue-store"
import { beginOperatorMaintenance } from "@/lib/operator-maintenance"
import type { QueueItem } from "@/types"
const item = (id: string, v: number): QueueItem => ({
  id,
  verse: {
    id: v,
    translation_id: 1,
    book_number: 43,
    book_name: "John",
    book_abbreviation: "Jn",
    chapter: 3,
    verse: v,
    text: "Verified fixture",
  },
  reference: `John 3:${v}`,
  translation_code: "KJV",
  confidence: 1,
  source: "manual",
  added_at: 1,
})
let root: Root, host: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  action.present.mockReset()
  useQueueStore.setState({
    items: [item("old", 16)],
    activeIndex: null,
    highlightedId: null,
  })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<QueuePanel />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
it("does not present or clear new-session rows through a retained old control", async () => {
  const row = host.querySelector<HTMLElement>('[data-operator-item="old"]')!
  const clear = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Clear all"
  )!
  await act(async () => {
    const lease = beginOperatorMaintenance()
    useQueueStore.getState().clearQueue()
    lease.release()
    useQueueStore.getState().addItem(item("new", 17))
    row.click()
    clear.click()
  })
  expect(action.present).not.toHaveBeenCalled()
  expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["new"])
})
it("presents the row's identity when a new arrival shifts its index before React commits", async () => {
  const row = host.querySelector<HTMLElement>('[data-operator-item="old"]')!
  await act(async () => {
    useQueueStore.getState().addItem(item("new", 17))
    row.click()
  })
  expect(action.present).toHaveBeenCalledWith(1)
})
it("does not enable a control rendered during maintenance when the lease releases", async () => {
  let lease: ReturnType<typeof beginOperatorMaintenance>
  await act(async () => {
    lease = beginOperatorMaintenance()
  })
  const clear = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Clear all"
  )!
  await act(async () => {
    useQueueStore.getState().clearQueue()
    lease.release()
    useQueueStore.getState().addItem(item("new", 17))
    clear.click()
  })
  expect(useQueueStore.getState().items.map((item) => item.id)).toEqual(["new"])
})
