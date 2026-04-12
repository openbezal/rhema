import { Dashboard } from "@/components/layout/dashboard"
import { useRemoteControl } from "@/hooks/use-remote-control"
import { TutorialOverlay } from "@/components/tutorial/tutorial-overlay"
import { Toaster } from "sonner"

export function App() {
  useRemoteControl()
  return (
    <>
      <Dashboard />
      <TutorialOverlay />
      <Toaster position="bottom-right" />
    </>
  )
}

export default App
