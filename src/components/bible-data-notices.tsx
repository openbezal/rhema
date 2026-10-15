import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import yorubaNotice from "../../data/licenses/OYCB-NOTICE.txt?raw"

export function BibleDataNotices() {
  return (
    <Dialog>
      <DialogTrigger asChild><Button size="sm" variant="outline">Bible data notices</Button></DialogTrigger>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogTitle>Bible data notices</DialogTitle>
        <DialogDescription>Copyright, source and license details for the Yoruba Bible.</DialogDescription>
        <pre className="min-h-0 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed [overflow-wrap:anywhere]">{yorubaNotice}</pre>
      </DialogContent>
    </Dialog>
  )
}
