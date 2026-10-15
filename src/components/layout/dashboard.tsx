import { TransportBar } from "@/components/controls/transport-bar"
import { TranscriptPanel } from "@/components/panels/transcript-panel"
import { PreviewPanel } from "@/components/panels/preview-panel"
import { LiveOutputPanel } from "@/components/panels/live-output-panel"
import { QueuePanel } from "@/components/panels/queue-panel"
import { SearchPanel } from "@/components/panels/search-panel"
import { SuggestionsPanel } from "@/components/panels/suggestions-panel"
import { DetectionsPanel } from "@/components/panels/detections-panel"
import { EmbeddingWarningBanner } from "@/components/ui/embedding-warning-banner"

export function Dashboard() {
  return (
    <div
      style={{
        position: "fixed",
        inset: "0px",
        display: "grid",
        // The `auto` row hosts the warning banner and collapses to 0 when
        // there is nothing to warn about.
        gridTemplateRows: "56px auto minmax(0, 2fr) minmax(0, 3fr)",
        overflow: "hidden",
      }}
      className="bg-background"
    >
      {/* Row 1: Transport Bar */}
      <div className="col-span-4">
        <TransportBar />
      </div>

      {/* Row 2: warning banner (collapses when healthy) */}
      <EmbeddingWarningBanner />

      {/* Operator views retain readable heights when the workspace narrows. */}
      <div className="col-span-4 grid min-h-0 auto-rows-[minmax(15rem,1fr)] grid-cols-2 gap-3 overflow-y-auto p-3 min-[1024px]:auto-rows-[minmax(0,1fr)] min-[1024px]:grid-cols-4">
        <TranscriptPanel />
        <PreviewPanel />
        <LiveOutputPanel />
        <QueuePanel />
      </div>
      {/* Browsing, explicit citations and quotation suggestions have independent space. */}
      <div className="col-span-4 grid min-h-0 auto-rows-[minmax(18rem,1fr)] grid-cols-2 gap-3 overflow-y-auto px-3 pb-3 min-[1100px]:auto-rows-[minmax(0,1fr)] min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
        <div className="col-span-2 flex min-h-0 flex-col overflow-hidden min-[1100px]:col-span-1">
          <SearchPanel />
        </div>
        <DetectionsPanel />
        <SuggestionsPanel />
      </div>
    </div>
  )
}
