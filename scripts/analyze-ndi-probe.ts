import { readFileSync } from "node:fs"
import {
  analyzeNativeProbe,
  type Receipt,
  type Submission,
} from "./ndi-probe-analysis"
function records<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T)
}
try {
  const [
    submittedPath,
    receivedPath,
    output = "qa-0",
    clearAlpha = "0",
    fps = "30",
  ] = process.argv.slice(2)
  if (!submittedPath || !receivedPath)
    throw new Error(
      "Usage: bun scripts/analyze-ndi-probe.ts submitted.jsonl received.jsonl [qa-0] [clear alpha 0|255] [fps 24|30|60]"
    )
  if (!["0", "255"].includes(clearAlpha) || !["24", "30", "60"].includes(fps))
    throw new Error("Invalid alpha or fps")
  const result = analyzeNativeProbe(
    records<Submission>(submittedPath),
    records<Receipt>(receivedPath),
    output,
    Number(clearAlpha),
    Number(fps)
  )
  console.log(JSON.stringify(result, null, 2))
  if (!result.valid) process.exitCode = 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
