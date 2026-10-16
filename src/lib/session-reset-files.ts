import { getSessionResetRecoveryArchive } from "./session-reset-controller"
import { exportCurrentSession } from "./session-archive-files"
import { saveExportDocument } from "./document-files"
import { transcriptDocumentText } from "./session-archive"

/** Recovery always exports the detached pre-reset data, even if publication
 * already cleared some active stores before encountering an error. */
export function exportBeforeNewSession(
  format: "archive" | "transcript"
): Promise<boolean> {
  const recovery = getSessionResetRecoveryArchive()
  if (!recovery)
    return exportCurrentSession(format, "Session before new-session reset")
  return format === "transcript"
    ? saveExportDocument(
        transcriptDocumentText(recovery),
        "text",
        recovery.title
      )
    : saveExportDocument(
        JSON.stringify(recovery, null, 2),
        "json",
        recovery.title
      )
}
