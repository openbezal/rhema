import { invoke } from "@tauri-apps/api/core"

export interface ImportedDocument {
  name: string
  text: string
}

/** Native dialogs own path selection. False means the operator cancelled. */
export function saveExportDocument(
  content: string,
  format: "json" | "text",
  defaultName: string
): Promise<boolean> {
  return invoke("save_export_document", { content, format, defaultName })
}

export function readImportDocument(): Promise<ImportedDocument | null> {
  return invoke("read_import_document")
}
