/** Reveal within the Bible list, preserving the outer workspace's panel/focus.
 * Element.scrollIntoView would also scroll every ancestor, hiding Detections
 * after an explicit presentation in a narrow controller window. */
export function revealVerseInList(
  row: HTMLElement,
  block: ScrollLogicalPosition
) {
  const list = row.closest<HTMLElement>('[data-operator-list="bible"]')
  if (!list) return
  const bounds = list.getBoundingClientRect()
  const verse = row.getBoundingClientRect()
  const top = bounds.top + list.clientTop
  const bottom = top + list.clientHeight
  let target = list.scrollTop
  if (block === "center")
    target += verse.top - top - (list.clientHeight - verse.height) / 2
  else if (block === "start") target += verse.top - top
  else if (block === "end") target += verse.bottom - bottom
  else if (verse.top < top) target += verse.top - top
  else if (verse.bottom > bottom) target += verse.bottom - bottom
  else return
  target = Math.max(0, Math.min(target, list.scrollHeight - list.clientHeight))
  list.scrollTo?.({ top: target, behavior: "smooth" })
}
