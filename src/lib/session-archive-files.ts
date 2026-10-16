import { readImportDocument, saveExportDocument } from "./document-files"
import {
  capturePreferencesDocument,
  captureSessionArchive,
  captureTranscriptSnapshot,
  parseSessionDocument,
  transcriptDocumentText,
} from "./session-archive"

export type SessionExport = "archive" | "transcript" | "preferences"

export async function exportCurrentSession(
  format: SessionExport,
  title: string
): Promise<boolean> {
  if (format === "transcript")
    return saveExportDocument(
      transcriptDocumentText(captureTranscriptSnapshot(title)),
      "text",
      title
    )
  const document =
    format === "preferences"
      ? capturePreferencesDocument()
      : captureSessionArchive(title)
  return saveExportDocument(
    JSON.stringify(document, null, 2),
    "json",
    format === "preferences" ? "Rhema preferences" : title
  )
}

export async function openSessionDocument() {
  const selected = await readImportDocument()
  return selected
    ? { name: selected.name, document: parseSessionDocument(selected.text) }
    : null
}
