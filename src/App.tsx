import { Dashboard } from "@/components/layout/dashboard"
import { useRemoteControl } from "@/hooks/use-remote-control"

export function App() {
  useRemoteControl()
  return <Dashboard />
}

export default App
