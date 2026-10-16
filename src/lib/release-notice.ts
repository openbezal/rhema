import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { create } from "zustand"
import { z } from "zod"

const version = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
const AvailableSchema = z
  .object({
    status: z.literal("available"),
    current_version: version,
    latest_version: version,
    url: z.string().max(200),
  })
  .refine(
    (notice) =>
      notice.url ===
        `https://github.com/openbezal/rhema/releases/tag/v${notice.latest_version}` ||
      notice.url ===
        `https://github.com/openbezal/rhema/releases/tag/${notice.latest_version}`
  )
const NoticeSchema = z.union([
  z.object({ status: z.literal("current"), current_version: version }),
  AvailableSchema,
  z.object({ status: z.literal("unavailable") }),
])
type ReleaseNotice = Exclude<
  z.infer<typeof NoticeSchema>,
  { status: "unavailable" }
>
export const useReleaseNoticeStore = create<{
  checking: boolean
  notice: ReleaseNotice | null
}>(() => ({ checking: false, notice: null }))
let initial: Promise<ReleaseNotice | null> | null = null
let inFlight: Promise<ReleaseNotice | null> | null = null
let announcement: Promise<void> | null = null

function check(retry: boolean): Promise<ReleaseNotice | null> {
  if (inFlight) return inFlight
  useReleaseNoticeStore.setState({ checking: true })
  const job = (async () => {
    let notice: ReleaseNotice | null = null
    try {
      const result = NoticeSchema.safeParse(
        await invoke("check_release_notice", { retry })
      )
      if (result.success && result.data.status !== "unavailable")
        notice = result.data
    } catch {
      /* Offline startup is ordinary; Diagnostics exposes explicit retry. */
    }
    useReleaseNoticeStore.setState({ notice, checking: false })
    return notice
  })()
  initial = job
  inFlight = job
  void job.then(() => {
    if (inFlight === job) inFlight = null
  })
  return job
}
export function getReleaseNotice(): Promise<ReleaseNotice | null> {
  return inFlight ?? initial ?? check(false)
}
export function retryReleaseNotice(): Promise<ReleaseNotice | null> {
  return check(true)
}
export async function downloadRelease(notice: unknown): Promise<void> {
  const verified = AvailableSchema.safeParse(notice)
  if (!verified.success) return
  try {
    await openUrl(verified.data.url)
  } catch {
    toast.error("Could not open the release page", {
      description: "Try Download again from Settings → Diagnostics.",
    })
  }
}
/** Shared independently of the App effect's StrictMode/remount lifecycle. The
 * native claim also survives a main-webview reload during this process. */
export function showStartupReleaseNotice(): Promise<void> {
  if (announcement) return announcement
  announcement = (async () => {
    const notice = await getReleaseNotice()
    if (notice?.status !== "available") return
    try {
      if ((await invoke("claim_release_notice")) !== true) return
      toast(`Rhema ${notice.latest_version} is available`, {
        id: "rhema-release-notice",
        description: `You are running ${notice.current_version}.`,
        duration: 10_000,
        closeButton: true,
        action: { label: "Download", onClick: () => downloadRelease(notice) },
      })
    } catch {
      /* A failed launch claim never produces an error toast. */
    }
  })()
  return announcement
}
