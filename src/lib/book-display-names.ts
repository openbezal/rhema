import { z } from "zod"
import type { Verse, VerseRenderData } from "@/types"
import { formatVerseReference } from "./verse-reference"

export const BookDisplayOverridesSchema = z
  .array(
    z.object({
      translationCode: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/),
      bookNumber: z.number().int().min(1).max(66),
      label: z
        .string()
        .transform((label) => label.normalize("NFC").trim())
        .pipe(
          z
            .string()
            .min(1)
            .max(120)
            .refine(
              (label) =>
                ![...label].some((character) => {
                  const code = character.charCodeAt(0)
                  return code <= 31 || (code >= 127 && code <= 159)
                }),
              "Use a single-line book name"
            )
        ),
    })
  )
  .max(6600)
  .superRefine((names, context) => {
    const seen = new Set<string>()
    names.forEach((item, index) => {
      const key = `${item.translationCode}:${item.bookNumber}`
      if (seen.has(key))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Keep one display name per edition and book",
        })
      seen.add(key)
    })
  })
export type BookDisplayOverride = z.infer<
  typeof BookDisplayOverridesSchema
>[number]

export function displayBookName(
  canonicalName: string,
  bookNumber: number,
  translationCode: string | null | undefined,
  names: readonly BookDisplayOverride[] = []
): string {
  return (
    names.find(
      (item) =>
        item.translationCode === translationCode &&
        item.bookNumber === bookNumber
    )?.label ?? canonicalName
  )
}

export function displayVerseReference(
  verse: Pick<Verse, "book_name" | "book_number" | "chapter" | "verse">,
  code: string | null | undefined,
  names: readonly BookDisplayOverride[] = [],
  chapterOnly = false,
  reference?: string
): string {
  const name = displayBookName(verse.book_name, verse.book_number, code, names)
  if (reference !== undefined) {
    if (name === verse.book_name) return reference
    const coordinate = ` ${verse.chapter}${chapterOnly ? "" : `:${verse.verse}`}`
    if (reference.endsWith(coordinate)) return `${name}${coordinate}`
    return reference.startsWith(`${verse.book_name} `)
      ? name + reference.slice(verse.book_name.length)
      : reference
  }
  return `${name} ${verse.chapter}${chapterOnly ? "" : `:${verse.verse}`}`
}

/** Canonical metadata remains available for lookup; only the UI alias is added. */
export function displayBooks<T extends { book_number: number; name: string }>(
  books: readonly T[],
  code: string | null | undefined,
  names: readonly BookDisplayOverride[] = []
): (T & { displayName: string })[] {
  return books.map((book) => ({
    ...book,
    displayName: displayBookName(book.name, book.book_number, code, names),
  }))
}

/** Formatting changes retain verified text, coordinates and user intent. */
export function applyBookDisplayNames(
  data: VerseRenderData,
  names: readonly BookDisplayOverride[] = []
): VerseRenderData {
  if (!data.address) return data
  const { bookName, bookNumber, translationCode } = data.address
  const label = displayBookName(bookName, bookNumber, translationCode, names)
  const displayName = label === bookName ? undefined : label
  if (data.address.displayBookName === displayName) return data
  const address = { ...data.address }
  if (displayName) address.displayBookName = displayName
  else delete address.displayBookName
  const result = { ...data, address }
  return { ...result, reference: formatVerseReference(result) }
}

export function replaceEditionBookNames(
  current: readonly BookDisplayOverride[],
  code: string,
  rows: readonly { bookNumber: number; canonicalName: string; label: string }[]
): BookDisplayOverride[] {
  const editedBooks = new Set(rows.map((row) => row.bookNumber))
  return BookDisplayOverridesSchema.parse([
    ...current.filter(
      (item) =>
        item.translationCode !== code || !editedBooks.has(item.bookNumber)
    ),
    ...rows
      .filter(
        (row) =>
          row.label.trim() &&
          row.label.normalize("NFC").trim() !==
            row.canonicalName.normalize("NFC").trim()
      )
      .map((row) => ({
        translationCode: code,
        bookNumber: row.bookNumber,
        label: row.label,
      })),
  ])
}
