import { useId, useState } from "react"
import { ArchiveIcon } from "lucide-react"
import { ZodError } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { useTranscriptStore } from "@/stores/transcript-store"
import { useQueueStore } from "@/stores/queue-store"
import { useDetectionStore } from "@/stores/detection-store"
import {
  exportCurrentSession,
  openSessionDocument,
  type SessionExport,
} from "@/lib/session-archive-files"
import type { SessionDocument } from "@/lib/session-archive"

const exportNames: Record<SessionExport, string> = {
  archive: "session JSON",
  transcript: "transcript TXT",
  preferences: "preferences JSON",
}
const sourceNames: Record<string, string> = {
  manual: "Manual",
  direct: "Spoken reference",
  "ai-direct": "Spoken reference",
  semantic: "Quotation search",
  "ai-semantic": "Quotation search",
  "ai-cloud": "Cloud suggestion",
}
const scoreNames: Record<string, string> = {
  reference: "Reference match",
  fts_rank: "Keyword rank",
  cosine: "Semantic similarity",
  hybrid: "Combined search score",
  unknown: "Score unavailable",
}
function describeError(error: unknown): string {
  if (error instanceof ZodError) {
    const issue = error.issues[0]
    if (issue.path[0] === "version")
      return "This document version is not supported. Use the Rhema version that created the export."
    if (issue.path[0] === "kind")
      return "Choose a Rhema session or preferences JSON export."
    if (issue.path.includes("customThemes"))
      return "A saved custom theme contains invalid values. Choose another export."
    return "The file contains invalid session data. Choose another Rhema export."
  }
  if (error instanceof SyntaxError)
    return "The file is not valid JSON. Choose a Rhema JSON export."
  return error instanceof Error ? error.message : String(error)
}

function ReferenceText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
        {expanded ? text : text.slice(0, 2000)}
      </p>
      {text.length > 2000 && (
        <Button variant="link" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less text" : "Show full text"}
        </Button>
      )}
    </>
  )
}

type SavedRow = {
  reference: string
  verse: { text: string; translationCode: string | null }
  source: string
  scoreKind?: string
}
function ReferenceList({ title, rows }: { title: string; rows: SavedRow[] }) {
  const [limit, setLimit] = useState(100)
  return (
    <section className="space-y-3">
      <h4 className="font-medium">
        {title} ({rows.length})
      </h4>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No saved entries.</p>
      ) : (
        <ol
          aria-label={title}
          className="divide-y divide-border rounded-md border border-border px-3"
        >
          {rows.slice(0, limit).map((row, index) => (
            <li key={index} className="space-y-1.5 py-3">
              <p className="font-medium">
                {row.reference}{" "}
                <span className="text-muted-foreground">
                  {row.verse.translationCode ?? "Source unavailable"}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {sourceNames[row.source] ?? row.source}
                {row.scoreKind
                  ? ` / ${scoreNames[row.scoreKind] ?? "Score unavailable"}`
                  : ""}
              </p>
              <ReferenceText text={row.verse.text} />
            </li>
          ))}
        </ol>
      )}
      {rows.length > limit && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLimit(limit + 100)}
        >
          Show more {title.toLowerCase()}
        </Button>
      )}
    </section>
  )
}

function SavedReference({ document }: { document: SessionDocument }) {
  const [transcriptLimit, setTranscriptLimit] = useState(100)
  const preferences = document.preferences
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-medium">
          {document.kind === "rhema-session-archive"
            ? document.title
            : "Saved preferences"}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Exported {new Date(document.createdAt).toLocaleString()}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Opened for reference.
        </p>
      </div>
      {document.kind === "rhema-session-archive" && (
        <>
          <section className="space-y-3">
            <h4 className="font-medium">
              Saved transcript ({document.transcript.length})
            </h4>
            {document.transcript.length === 0 ? (
              <p className="text-muted-foreground">
                No completed transcript segments.
              </p>
            ) : (
              <ol aria-label="Saved transcript" className="space-y-3">
                {document.transcript
                  .slice(0, transcriptLimit)
                  .map((segment, index) => (
                    <li key={index} className="space-y-1">
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={new Date(segment.timestamp).toISOString()}
                      >
                        {new Date(segment.timestamp).toLocaleTimeString()}
                      </time>
                      <ReferenceText text={segment.text} />
                    </li>
                  ))}
              </ol>
            )}
            {document.transcript.length > transcriptLimit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTranscriptLimit(transcriptLimit + 100)}
              >
                Show more saved transcript
              </Button>
            )}
          </section>
          <ReferenceList title="Saved Queue" rows={document.queue} />
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Detections and quotation history are snapshots of the retained
              results at export time.
            </p>
            <ReferenceList
              title="Saved detections"
              rows={document.detections}
            />
            <ReferenceList
              title="Saved quotation history"
              rows={document.suggestions}
            />
          </div>
        </>
      )}
      <section className="space-y-3">
        <h4 className="font-medium">Saved preferences</h4>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Primary Bible</dt>
          <dd>{preferences.primaryTranslationCode ?? "Unconfirmed"}</dd>
          <dt className="text-muted-foreground">Secondary Bible</dt>
          <dd>{preferences.secondaryTranslationCode ?? "None"}</dd>
          <dt className="text-muted-foreground">Transcription provider</dt>
          <dd>
            {preferences.settings.sttProvider === "deepgram"
              ? "Deepgram"
              : "Local Whisper"}
          </dd>
          <dt className="text-muted-foreground">Input gain</dt>
          <dd>{preferences.settings.gain}×</dd>
          <dt className="text-muted-foreground">Detection threshold</dt>
          <dd>{preferences.settings.confidenceThreshold * 100}%</dd>
          <dt className="text-muted-foreground">Detection cooldown</dt>
          <dd>{preferences.settings.cooldownMs} ms</dd>
          <dt className="text-muted-foreground">Quotation history capacity</dt>
          <dd>{preferences.settings.suggestionCapacity}</dd>
          <dt className="text-muted-foreground">Quotation retention</dt>
          <dd>{preferences.settings.suggestionRetentionMs / 1000} s</dd>
          <dt className="text-muted-foreground">Automatic detection</dt>
          <dd>{preferences.settings.autoMode ? "Enabled" : "Disabled"}</dd>
          <dt className="text-muted-foreground">Follow detections</dt>
          <dd>{preferences.followDetections ? "Enabled" : "Disabled"}</dd>
          <dt className="text-muted-foreground">Auto live</dt>
          <dd>{preferences.autoLive ? "Enabled" : "Disabled"}</dd>
          <dt className="text-muted-foreground">Saved custom themes</dt>
          <dd>{preferences.customThemes.length}</dd>
        </dl>
        {preferences.customThemes.length > 0 && (
          <ul className="list-inside list-disc text-sm">
            {preferences.customThemes.map((theme, index) => (
              <li key={index}>{theme.name}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export function SessionArchivePanel() {
  const titleId = useId()
  const [title, setTitle] = useState("Current session")
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<{
    name: string
    document: SessionDocument
  } | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null
  )
  const finalSegments = useTranscriptStore(
    (state) => state.segments.filter((segment) => segment.is_final).length
  )
  const queueCount = useQueueStore((state) => state.items.length)
  const detectionCount = useDetectionStore((state) => state.detections.length)

  async function exportDocument(format: SessionExport) {
    setBusy(true)
    setNotice(null)
    try {
      const saved = await exportCurrentSession(
        format,
        title.trim() || "Current session"
      )
      setNotice({
        text: saved ? `Saved ${exportNames[format]}.` : "Export cancelled.",
        error: false,
      })
    } catch (error) {
      setNotice({ text: describeError(error), error: true })
    } finally {
      setBusy(false)
    }
  }
  async function openDocument() {
    setBusy(true)
    setNotice(null)
    try {
      const result = await openSessionDocument()
      if (result) setOpened(result)
      setNotice({
        text: result
          ? `Opened ${result.name} for reference.`
          : "Open cancelled.",
        error: false,
      })
    } catch (error) {
      setNotice({ text: describeError(error), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Session archive"
          title="Session archive"
        >
          <ArchiveIcon className="size-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b border-border p-5 pr-14">
          <SheetTitle>Session archive</SheetTitle>
          <SheetDescription>
            Save this session and open past sessions for reference.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5">
          <section className="space-y-4" aria-label="Current session exports">
            <div>
              <h3 className="text-base font-medium">Current session</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {finalSegments} completed segments, {queueCount} Queue entries,{" "}
                {detectionCount} recent detections
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor={titleId} className="text-sm font-medium">
                Session name
              </label>
              <Input
                id={titleId}
                maxLength={512}
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                className="sm:col-span-2"
                disabled={busy}
                onClick={() => void exportDocument("archive")}
              >
                Export session JSON
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void exportDocument("transcript")}
              >
                Export transcript TXT
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void exportDocument("preferences")}
              >
                Export preferences JSON
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Session JSON includes the final transcript, current Queue,
              retained detections and quotation history, portable preferences
              and saved custom themes. API keys and this computer’s audio and
              output mappings are excluded.
            </p>
            {busy && (
              <p className="text-sm text-muted-foreground">
                Waiting for the file dialog…
              </p>
            )}
            {notice && (
              <p
                role={notice.error ? "alert" : "status"}
                className={
                  notice.error
                    ? "text-sm break-words text-destructive"
                    : "text-sm break-words text-muted-foreground"
                }
              >
                {notice.text}
              </p>
            )}
          </section>
          <section
            className="space-y-4 border-t border-border pt-6"
            aria-label="Saved reference"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-medium">Saved reference</h3>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void openDocument()}
              >
                Open saved archive
              </Button>
            </div>
            {opened ? (
              <div className="space-y-4">
                <p className="text-xs break-all text-muted-foreground">
                  {opened.name}
                </p>
                <SavedReference
                  key={opened.name + opened.document.createdAt}
                  document={opened.document}
                />
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open a session or preferences JSON file to review its saved
                content here.
              </p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
