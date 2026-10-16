import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

interface TranslationInput { file: string; abbreviation: string; title: string; language: string; license: string }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
function optionalHash(path: string): string | null {
  try { return hash(readFileSync(path)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
export function createBibleBuildManifest(directory: string, translations: TranslationInput[]) {
  return {
    version: 3,
    schemaSha256: hash(readFileSync(new URL("../schema.sql", import.meta.url))),
    sourceSpecificationSha256: hash(readFileSync(new URL("../yoruba-source.json", import.meta.url))),
    localSourceSpecificationSha256: hash(readFileSync(new URL("../local-bible-sources.json", import.meta.url))),
    translations: translations.flatMap((translation) => {
      const sha256 = optionalHash(join(directory, "sources", translation.file))
      return sha256 ? [{ ...translation, sha256 }] : []
    }),
    crossReferencesSha256: optionalHash(join(directory, "cross-refs", "cross_references.txt")),
  }
}
