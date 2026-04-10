import { message, open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeTextFile } from "@tauri-apps/plugin-fs"

const IMAGE_FILTER = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
}

function normalizeDialogPath(path: string | string[] | null) {
  if (!path) return null
  return Array.isArray(path) ? path[0] ?? null : path
}

function inferImageMimeType(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? ""
  return IMAGE_MIME_BY_EXTENSION[extension] ?? "application/octet-stream"
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 0x8000
  let output = ""

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    output += String.fromCharCode(...chunk)
  }

  return btoa(output)
}

export async function pickThemeBackgroundImage() {
  const filePath = normalizeDialogPath(
    await open({
      title: "Choose Background Image",
      filters: [IMAGE_FILTER],
      multiple: false,
      directory: false,
      pickerMode: "image",
      fileAccessMode: "copy",
    }),
  )

  if (!filePath) return null
  const bytes = await readFile(filePath)
  const mimeType = inferImageMimeType(filePath)
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

export async function saveThemeExportFile(fileName: string, contents: string) {
  const filePath = await save({
    title: "Export Themes",
    defaultPath: fileName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  })

  if (!filePath) return false
  await writeTextFile(filePath, contents)
  return true
}

export async function showThemeDesignerMessage(
  body: string,
  kind: "info" | "warning" | "error" = "info",
) {
  await message(body, {
    title: "Theme Designer",
    kind,
  })
}
