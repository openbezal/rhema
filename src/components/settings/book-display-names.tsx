import { useEffect, useId, useMemo, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { Book, Translation } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  useSettingsStore,
  flushSettingsPersistence,
} from "@/stores/settings-store"
import { useProfileStatusStore } from "@/lib/profile-status"
import {
  useOperatorMaintenanceStore,
  isOperatorWorkCurrent,
  operatorRevision,
} from "@/lib/operator-maintenance"
import {
  displayBookName,
  replaceEditionBookNames,
} from "@/lib/book-display-names"
import { restoreTranslationChoices } from "@/lib/preference-restore"
import { translationCode } from "@/lib/translation-selection"

type Row = { bookNumber: number; canonicalName: string; label: string }
export function BookDisplayNamesEditor({
  translations,
  primaryCode,
}: {
  translations: Translation[]
  primaryCode: string | null
}) {
  const choices = useMemo(
    () => restoreTranslationChoices(translations),
    [translations]
  )
  const [requestedCode, setCode] = useState(primaryCode ?? "")
  const code = choices.some((item) => translationCode(item) === requestedCode)
    ? requestedCode
    : choices.some((item) => translationCode(item) === primaryCode)
      ? primaryCode!
      : choices[0]
        ? translationCode(choices[0])
        : ""
  const selected = choices.find((item) => translationCode(item) === code)
  const blocked = useOperatorMaintenanceStore((state) => state.phase !== "idle")
  const revision = useOperatorMaintenanceStore((state) => state.revision)
  const [busy, setBusy] = useState(false)
  const selectId = useId()
  return (
    <section className="flex flex-col gap-3" aria-label="Book display names">
      <div>
        <h3 className="text-sm font-medium">Book display names</h3>
        <p className="text-xs text-muted-foreground">
          Rename books for display and typed search. Canonical Bible data and
          spoken-reference recognition stay the same. Empty names use the
          original.
        </p>
      </div>
      <label className="text-xs" htmlFor={selectId}>
        Book name edition
      </label>
      <select
        id={selectId}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={code}
        disabled={busy || blocked || !selected}
        onChange={(event) => setCode(event.target.value)}
      >
        {choices.map((item) => (
          <option key={translationCode(item)} value={translationCode(item)}>
            {translationCode(item)} — {item.title}
          </option>
        ))}
      </select>
      {selected ? (
        <EditionBookNames
          key={`${code}:${selected.id}:${revision}`}
          code={code}
          translationId={selected.id}
          blocked={blocked}
          busy={busy}
          onBusyChange={setBusy}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Install a Bible translation to edit its book names.
        </p>
      )}
    </section>
  )
}

/** Edition identity and maintenance revision own the async load and draft. */
function EditionBookNames({
  code,
  translationId,
  blocked,
  busy,
  onBusyChange,
}: {
  code: string
  translationId: number
  blocked: boolean
  busy: boolean
  onBusyChange: (busy: boolean) => void
}) {
  const names = useSettingsStore((state) => state.bookDisplayOverrides)
  const unreadable = useProfileStatusStore((state) => state.readFailed)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadRevision, setLoadRevision] = useState(0)
  const [filter, setFilter] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (blocked) return
    let cancelled = false
    const epoch = operatorRevision()
    void invoke<Book[]>("list_books", { translationId })
      .then((books) => {
        if (cancelled || !isOperatorWorkCurrent(epoch)) return
        const current = useSettingsStore.getState().bookDisplayOverrides
        setRows(
          books.map((book) => {
            const label = displayBookName(
              book.name,
              book.book_number,
              code,
              current
            )
            return {
              bookNumber: book.book_number,
              canonicalName: book.name,
              label: label === book.name ? "" : label,
            }
          })
        )
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not load this edition's book list. Retry loading books."
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [code, translationId, blocked, loadRevision])

  async function save() {
    const epoch = operatorRevision()
    if (!isOperatorWorkCurrent(epoch) || unreadable || busy || loading) return
    setError(null)
    setNotice(null)
    try {
      const next = replaceEditionBookNames(
        useSettingsStore.getState().bookDisplayOverrides,
        code,
        rows
      )
      onBusyChange(true)
      useSettingsStore.getState().setBookDisplayOverrides(next)
      await flushSettingsPersistence()
      if (isOperatorWorkCurrent(epoch)) setNotice("Names saved")
    } catch (error) {
      if (isOperatorWorkCurrent(epoch))
        setError(
          `Changes not saved. Names may apply for this session only. Retry Save names. ${error instanceof Error ? error.message : "Check the names and try again."}`
        )
    } finally {
      onBusyChange(false)
    }
  }
  const visible = rows.filter((row) =>
    `${row.canonicalName} ${row.label}`
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase())
  )
  return (
    <>
      <Input
        placeholder="Find a book"
        aria-label="Find a book to rename"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {loading && (
        <p className="text-xs text-muted-foreground">Loading book names…</p>
      )}
      {!loading && !rows.length && error && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true)
            setError(null)
            setLoadRevision((current) => current + 1)
          }}
        >
          Retry loading books
        </Button>
      )}
      <fieldset
        disabled={loading || busy || blocked || unreadable}
        className="max-h-72 space-y-3 overflow-auto rounded-md border p-3"
      >
        {visible.map((row) => (
          <label key={row.bookNumber} className="flex flex-col gap-1 text-xs">
            {row.bookNumber}. {row.canonicalName}
            <Input
              aria-label={`${row.canonicalName} display name`}
              maxLength={120}
              placeholder={row.canonicalName}
              value={row.label}
              onChange={(event) => {
                setNotice(null)
                setRows((current) =>
                  current.map((item) =>
                    item.bookNumber === row.bookNumber
                      ? { ...item, label: event.target.value }
                      : item
                  )
                )
              }}
            />
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={loading || busy || blocked || unreadable || !rows.length}
          onClick={() => void save()}
        >
          Save names
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || busy || blocked || unreadable || !rows.length}
          onClick={() => {
            setRows((current) => current.map((row) => ({ ...row, label: "" })))
            setNotice("Edition names reset in the editor. Save names to apply.")
            setError(null)
          }}
        >
          Reset edition names
        </Button>
      </div>
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Wait for preference restore to finish before editing names.
        </p>
      )}
      {unreadable && (
        <p className="text-xs text-destructive">
          Restart Rhema before changing unreadable preferences.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {names.filter((item) => item.translationCode === code).length} custom
        names applied for {code}.
      </p>
    </>
  )
}
