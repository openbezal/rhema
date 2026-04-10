import { convertFileSrc } from "@tauri-apps/api/core"
import { message, open, save } from "@tauri-apps/plugin-dialog"
import { writeTextFile } from "@tauri-apps/plugin-fs"

const IMAGE_FILTER = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
}

function normalizeDialogPath(path: string | string[] | null) {
  if (!path) return null
  return Array.isArray(path) ? path[0] ?? null : path
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
  return convertFileSrc(filePath)
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
