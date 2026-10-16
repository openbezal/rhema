import notice from "../../../data/licenses/OYCB-NOTICE.txt?raw"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
/** Importing the notice as text also retains it inside packaged frontend assets. */
export function DesignerSampleCredits() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-[0.625rem]">
          Sample credits
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bilingual design sample</DialogTitle>
          <DialogDescription>
            Genesis 1:1 · KJV and Biblica® Open Yoruba Contemporary Bible™.
            Scripture wording is unchanged.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-auto text-xs break-words whitespace-pre-wrap">
          {notice}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
