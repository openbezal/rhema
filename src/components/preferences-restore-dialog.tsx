import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useOperatorMaintenanceStore } from "@/lib/operator-maintenance"
import { usePreferenceRestoreReadiness } from "@/hooks/use-preference-restore-readiness"
import {
  stagePreferencesRestore,
  restoreTranslationChoices,
  type StagedPreferencesRestore,
} from "@/lib/preference-restore"
import { applyPreferencesRestore } from "@/lib/preference-restore-controller"
import { exportCurrentSession } from "@/lib/session-archive-files"
import type { SessionDocument } from "@/lib/session-archive"
import { translationCode } from "@/lib/translation-selection"
import { SessionPreferencesSummary } from "./session-preferences-summary"

export function PreferencesRestoreDialog({
  preferences,
  sourceName,
  onApplied,
  disabled = false,
}: {
  preferences: SessionDocument["preferences"]
  sourceName: string
  onApplied: () => void
  disabled?: boolean
}) {
  const [review, setReview] = useState<StagedPreferencesRestore | null>(null)
  const [primary, setPrimary] = useState("")
  const [secondary, setSecondary] = useState("")
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const translations = useBibleStore((state) => state.translations)
  const themes = useBroadcastStore((state) => state.themes)
  const hasDeepgramKey = useSettingsStore((state) =>
    Boolean(state.deepgramApiKey?.trim())
  )
  const maintenance = useOperatorMaintenanceStore()
  const blocked = usePreferenceRestoreReadiness()
  const primaryId = useId(),
    secondaryId = useId()
  const recovery = maintenance.phase === "recovery"
  const choices = restoreTranslationChoices(translations)
  const codes = new Set(choices.map(translationCode))
  const mappingError = !primary
    ? "Choose an installed primary translation."
    : secondary === ""
      ? "Choose a secondary translation or None."
      : !codes.has(primary) || (secondary !== "none" && !codes.has(secondary))
        ? "A selected translation is no longer available. Review the choices."
        : primary === secondary
          ? "Choose a different secondary translation or None."
          : null
  function prepare() {
    try {
      const stage = stagePreferencesRestore(preferences, translations, themes)
      setReview(stage)
      setPrimary(stage.primaryCode ?? "")
      setSecondary(
        stage.secondaryCode === undefined ? "" : (stage.secondaryCode ?? "none")
      )
      setError(null)
      setNotice(null)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not review these preferences"
      )
    }
  }
  async function apply() {
    if (!review || busy || recovery) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await applyPreferencesRestore(
        review,
        primary || null,
        secondary === "none" ? null : secondary || undefined
      )
      setNotice(
        "Preferences restored. Current session and output assignments kept."
      )
      setReview(null)
      onApplied()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not restore preferences. Try again."
      )
    } finally {
      setBusy(false)
    }
  }
  async function exportRecovery(format: "archive" | "transcript") {
    setExporting(true)
    setNotice(null)
    try {
      const saved = await exportCurrentSession(
        format,
        "Session before recovery reload"
      )
      setNotice(saved ? "Current session saved." : "Export cancelled.")
    } catch {
      setNotice(
        "Could not save this export. Try transcript TXT or another destination."
      )
    } finally {
      setExporting(false)
    }
  }
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !busy && !recovery) setReview(null)
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <DialogTrigger asChild>
          <Button variant="outline" disabled={disabled} onClick={prepare}>
            Review preferences
          </Button>
        </DialogTrigger>
        {!review && notice && (
          <p
            role="status"
            className="min-w-0 flex-1 text-xs text-muted-foreground"
          >
            {notice}
          </p>
        )}
      </div>
      {!review && error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-xl"
        showCloseButton={!busy && !recovery}
        onEscapeKeyDown={(event) => {
          if (busy || recovery) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy || recovery) event.preventDefault()
        }}
      >
        <DialogHeader className="border-b border-border p-5 pr-14">
          <DialogTitle>Restore preferences</DialogTitle>
          <DialogDescription className="break-words">
            Review the preferences from {sourceName}.
          </DialogDescription>
        </DialogHeader>
        {review && (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <p className="text-sm text-muted-foreground">
              Your current transcript, Queue, microphone, API keys and output
              assignments stay in place. Saved themes are added as separate
              copies.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor={primaryId} className="text-sm font-medium">
                  Primary Bible
                </label>
                <select
                  id={primaryId}
                  aria-label="Primary translation for this computer"
                  value={primary}
                  disabled={busy || recovery}
                  onChange={(event) => setPrimary(event.target.value)}
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                >
                  <option value="" disabled>
                    Choose an installed translation
                  </option>
                  {choices.map((item) => (
                    <option key={item.id} value={translationCode(item)}>
                      {translationCode(item)} — {item.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Saved choice:{" "}
                  {review.preferences.primaryTranslationCode ?? "Unconfirmed"}
                </p>
              </div>
              <div className="space-y-2">
                <label htmlFor={secondaryId} className="text-sm font-medium">
                  Secondary Bible
                </label>
                <select
                  id={secondaryId}
                  aria-label="Secondary translation for this computer"
                  value={secondary}
                  disabled={busy || recovery}
                  onChange={(event) => setSecondary(event.target.value)}
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                >
                  <option value="" disabled>
                    Choose a translation or None
                  </option>
                  <option value="none">None</option>
                  {choices.map((item) => (
                    <option key={item.id} value={translationCode(item)}>
                      {translationCode(item)} — {item.title}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Saved choice:{" "}
                  {review.preferences.secondaryTranslationCode ?? "None"}
                </p>
              </div>
            </div>
            <SessionPreferencesSummary
              preferences={review.preferences}
              showLanguages={false}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Check imported fonts and images in Theme Designer before assigning
              a theme to an output.
            </p>
            {review.preferences.settings.sttProvider === "deepgram" &&
              !hasDeepgramKey && (
                <p className="text-sm text-amber-500">
                  Deepgram may need an API key on this computer before
                  transcription can start.
                </p>
              )}
          </div>
        )}
        <DialogFooter className="flex-col border-t border-border p-5 sm:flex-col">
          <div className="space-y-2">
            {!busy && !recovery && (blocked || mappingError) && (
              <p role="status" className="text-sm text-amber-500">
                {blocked || mappingError}
              </p>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                Saving preferences…
              </p>
            )}
            {(error || maintenance.message) && (
              <p role="alert" className="text-sm break-words text-destructive">
                {maintenance.message ?? error}
              </p>
            )}
            {recovery && (
              <p className="text-sm text-muted-foreground">
                Export the current session before reloading to keep its
                transcript and Queue. Recheck surviving outputs after reload.
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {recovery ? (
              <>
                <Button
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void exportRecovery("archive")}
                >
                  Export current session
                </Button>
                <Button
                  variant="outline"
                  disabled={exporting}
                  onClick={() => void exportRecovery("transcript")}
                >
                  Export transcript TXT
                </Button>
                <Button
                  disabled={exporting}
                  onClick={() => window.location.reload()}
                >
                  Reload Rhema
                </Button>
                <Button disabled>Cancel</Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setReview(null)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={busy || Boolean(blocked) || Boolean(mappingError)}
                  onClick={() => void apply()}
                >
                  Apply preferences
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
