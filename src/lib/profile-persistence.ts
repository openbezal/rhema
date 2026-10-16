import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"
import { useProfileStatusStore } from "./profile-status"

const ProfileSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sections: z.object({
    settings: z.record(z.unknown()),
    bible: z.record(z.unknown()),
    broadcast: z.record(z.unknown()),
  }),
})
const ReceiptSchema = ProfileSchema.extend({
  sections: ProfileSchema.shape.sections.partial(),
})
type ProfileSnapshot = z.infer<typeof ProfileSchema>
type Section = keyof ProfileSnapshot["sections"]
export interface ProfileSectionStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  save(): Promise<void>
}

let snapshot: ProfileSnapshot | null = null
let hydration: Promise<ProfileSnapshot> | null = null
let writes: Promise<void> = Promise.resolve()

function loadProfile(): Promise<ProfileSnapshot> {
  if (snapshot) return Promise.resolve(snapshot)
  if (!hydration) {
    hydration = invoke<unknown>("read_local_profile")
      .then((value) => {
        snapshot = ProfileSchema.parse(value)
        return snapshot
      })
      .catch((error: unknown) => {
        hydration = null
        useProfileStatusStore.setState({ readFailed: true })
        throw error
      })
  }
  return hydration
}

type Change = { removed: true } | { removed: false; value: unknown }

/** The existing stores keep their hydration/debounce APIs over one native profile. */
export async function openProfileSection(
  section: Section
): Promise<ProfileSectionStore> {
  await loadProfile()
  const staged = new Map<string, Change>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const change = staged.get(key)
      if (change)
        return change.removed ? undefined : (structuredClone(change.value) as T)
      const values = (await loadProfile()).sections[section]
      return Object.hasOwn(values, key)
        ? (structuredClone(values[key]) as T)
        : undefined
    },
    async set(key, value) {
      staged.set(key, { removed: false, value: structuredClone(value) })
    },
    async delete(key) {
      staged.set(key, { removed: true })
    },
    save() {
      if (staged.size === 0) return Promise.resolve()
      const changes = new Map(staged)
      const saved = writes.then(async () => {
        const previous = await loadProfile()
        const values = structuredClone(previous.sections[section])
        for (const [key, change] of changes) {
          if (change.removed) delete values[key]
          else
            Object.defineProperty(values, key, {
              value: structuredClone(change.value),
              writable: true,
              configurable: true,
              enumerable: true,
            })
        }
        const receipt = ReceiptSchema.parse(
          await invoke<unknown>("write_local_profile", {
            expectedRevision: previous.revision,
            updates: { [section]: values },
          })
        )
        if (
          receipt.revision !== previous.revision + 1 ||
          !receipt.sections[section]
        )
          throw new Error("Invalid operator profile save receipt")
        snapshot = {
          ...previous,
          revision: receipt.revision,
          sections: { ...previous.sections, ...receipt.sections },
        }
        // New changes staged during this write must remain pending. Failed
        // writes retain their changes for retry instead of acknowledging them.
        for (const [key, change] of changes)
          if (staged.get(key) === change) staged.delete(key)
      })
      writes = saved.catch(() => {})
      return saved
    },
  }
}
