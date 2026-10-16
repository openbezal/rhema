import type { VerseRenderData } from "@/types/broadcast"

/** Format verified coordinates, never guess at numbers in a legacy label. */
export function formatVerseReference(
  verse: VerseRenderData,
  includeVerseNumbers = true
): string {
  const address = verse.address
  if (
    !address ||
    !Number.isInteger(address.bookNumber) ||
    address.bookNumber < 1 ||
    address.bookNumber > 66 ||
    typeof address.bookName !== "string" ||
    !address.bookName.trim() ||
    !Number.isInteger(address.chapter) ||
    address.chapter < 1 ||
    !Number.isInteger(address.verse) ||
    address.verse < 1 ||
    typeof address.translationCode !== "string" ||
    !address.translationCode.trim() ||
    (address.secondaryTranslationCode !== undefined &&
      (typeof address.secondaryTranslationCode !== "string" ||
        !address.secondaryTranslationCode.trim()))
  )
    return verse.reference

  const coordinate = `${address.chapter}${includeVerseNumbers ? `:${address.verse}` : ""}`
  const editions = `${address.translationCode}${address.secondaryTranslationCode ? ` · ${address.secondaryTranslationCode}` : ""}`
  const bookName =
    typeof address.displayBookName === "string" &&
    address.displayBookName.trim()
      ? address.displayBookName
      : address.bookName
  return `${bookName} ${coordinate} (${editions})`
}
