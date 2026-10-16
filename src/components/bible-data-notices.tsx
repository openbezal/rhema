import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import yorubaNotice from "../../data/licenses/OYCB-NOTICE.txt?raw"
import hausaNotice from "../../data/licenses/BSRK-NOTICE.txt?raw"
import igboNotice from "../../data/licenses/BIUO-NOTICE.txt?raw"
const notices = { OYCB: yorubaNotice, BSRK: hausaNotice, BIUO: igboNotice }

export function BibleDataNotices() {
  const [edition, setEdition] = useState<keyof typeof notices>("OYCB")
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Bible data notices
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogTitle>Bible data notices</DialogTitle>
        <DialogDescription>
          Copyright, source and license details for the Yoruba, Hausa and Igbo
          Bibles.
        </DialogDescription>
        <label className="flex items-center gap-3 text-sm">
          Language
          <select
            aria-label="Notice language"
            className="rounded border bg-background px-3 py-2"
            value={edition}
            onChange={(event) =>
              setEdition(event.target.value as keyof typeof notices)
            }
          >
            <option value="OYCB">Yoruba · OYCB</option>
            <option value="BSRK">Hausa · BSRK</option>
            <option value="BIUO">Igbo · BIUO</option>
          </select>
        </label>
        <pre
          key={edition}
          tabIndex={0}
          aria-label="Complete Bible data notice"
          className="min-h-0 overflow-y-auto font-sans text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
        >
          {notices[edition]}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
