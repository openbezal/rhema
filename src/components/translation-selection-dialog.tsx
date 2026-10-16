import { useState } from "react"
import { activateTranslation, hydrateBibleStore, useBibleStore } from "@/stores/bible-store"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useProfileStatusStore } from "@/lib/profile-status"

export function TranslationSelectionDialog() {
  const status = useBibleStore((state) => state.translationSelectionStatus)
  const translations = useBibleStore((state) => state.translations)
  const profileReadFailed = useProfileStatusStore((state) => state.readFailed)
  const [selectedId, setSelectedId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const installed = translations.filter((item) => item.is_downloaded)

  async function confirm() {
    setBusy(true)
    setError(null)
    try { await activateTranslation(Number(selectedId)) }
    catch (error) { setError(error instanceof Error ? error.message : "Could not select this translation. Try again.") }
    finally { setBusy(false) }
  }

  if (status === "unavailable") return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover p-3 text-sm shadow-lg">
      <span>Bible translations are unavailable. Complete setup or retry.</span>
      <Button size="sm" variant="outline" onClick={() => void hydrateBibleStore()}>Retry</Button>
    </div>
  )

  return (
    <Dialog open={status === "needs_confirmation"}>
      <DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Choose your Bible translation</DialogTitle>
          <DialogDescription>
            {profileReadFailed
              ? "Saved preferences could not be loaded. Choose an installed translation for this session. Restart Rhema to retry your saved preferences."
              : "Choose an installed translation before presenting verses. Your choice will be saved for future Bible data updates."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor="confirmed-translation" className="text-sm font-medium">Bible translation</label>
          <Select value={selectedId} onValueChange={setSelectedId} disabled={busy}>
            <SelectTrigger id="confirmed-translation" className="w-full"><SelectValue placeholder="Select a translation" /></SelectTrigger>
            <SelectContent>
              {installed.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.abbreviation} — {item.title}</SelectItem>)}
            </SelectContent>
          </Select>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={busy || !installed.some((item) => String(item.id) === selectedId)} onClick={() => void confirm()}>
            {busy ? "Selecting…" : "Use this translation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
