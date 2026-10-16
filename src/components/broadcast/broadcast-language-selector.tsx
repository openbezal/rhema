import { useBibleStore } from "@/stores/bible-store"
import { translationCode } from "@/lib/translation-selection"
/** Primary remains the Bible browser's verified selection; secondary affects
 * presentation/preview only and never changes native detection's primary. */
export function BroadcastLanguageSelector() {
  const translations = useBibleStore((state) => state.translations)
  const primary = useBibleStore((state) => state.activeTranslationCode)
  const secondary = useBibleStore((state) => state.secondaryTranslationCode)
  const ready = useBibleStore(
    (state) => state.translationSelectionStatus === "ready"
  )
  const choose = useBibleStore((state) => state.setSecondaryTranslation)
  const installed = translations.filter((item) => item.is_downloaded)
  const choices = installed.filter(
    (item) =>
      translationCode(item) !== primary &&
      installed.filter(
        (other) => translationCode(other) === translationCode(item)
      ).length === 1
  )
  return (
    <div
      data-slot="broadcast-languages"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-[0.625rem] text-muted-foreground"
    >
      <span title="Primary follows the Bible translation selected in Search">
        Primary{" "}
        <strong className="ml-1 text-foreground">
          {primary ?? "Unconfirmed"}
        </strong>
      </span>
      <label className="flex min-w-0 items-center gap-2">
        <span>Secondary</span>
        <select
          aria-label="Secondary broadcast translation"
          value={secondary ?? ""}
          disabled={!ready}
          onChange={(event) => choose(event.target.value || null)}
          className="min-w-0 rounded border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
        >
          <option value="">None</option>
          {choices.map((item) => (
            <option key={translationCode(item)} value={translationCode(item)}>
              {translationCode(item)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
