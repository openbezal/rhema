import { usePresentationController } from "@/hooks/use-presentation-controller"
import { Dashboard } from "@/components/layout/dashboard"
import { useBroadcastOutputs } from "@/hooks/use-broadcast-outputs"
import { useBibleNavigation } from "@/hooks/use-bible-navigation"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { TranslationSelectionDialog } from "@/components/translation-selection-dialog"
import { Toaster } from "sonner"

export function App() {
  usePresentationController()
  useBibleNavigation()
  useRemoteControl()
  useBroadcastOutputs()
  return (
    <>
      <Dashboard />
      <TranslationSelectionDialog />
      <TutorialOverlay />
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
