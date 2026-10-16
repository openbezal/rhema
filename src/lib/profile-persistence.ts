import { invoke } from "@tauri-apps/api/core"
import { z } from "zod"
import { useProfileStatusStore } from "./profile-status"
import { PortablePreferencesSchema } from "./session-archive-schema"
import {
  ResolvedPreferencesRestoreSchema,
  type ResolvedPreferencesRestore,
} from "./preference-restore"

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
const ResolvedPreferencesSchema = ResolvedPreferencesRestoreSchema
const ApplyReceiptSchema = z.object({
  profile: ProfileSchema,
  primary_translation_id: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  primary_translation_code:
    ResolvedPreferencesSchema.shape.primaryTranslationCode,
  secondary_translation_code:
    PortablePreferencesSchema.shape.secondaryTranslationCode,
})
const AppliedSchema = z.object({
  status: z.literal("applied"),
  receipt: ApplyReceiptSchema,
})
const RejectedSchema = z.object({
  status: z.literal("rejected"),
  message: z.string().max(2000),
})
export type ProfileApplyReceipt = z.infer<typeof ApplyReceiptSchema>
type ProfileSnapshot = z.infer<typeof ProfileSchema>
type Section = keyof ProfileSnapshot["sections"]
export interface ProfileSectionStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  save(isCurrent?: () => boolean): Promise<void>
}

let snapshot: ProfileSnapshot | null = null
let hydration: Promise<ProfileSnapshot> | null = null
let writes: Promise<void> = Promise.resolve()
let generation = 0
let profileFrozen = false
let publishingRestoredProfile = false
export const isPublishingRestoredProfile = () => publishingRestoredProfile

function requireWritableProfile() {
  if (profileFrozen)
    throw new Error(
      "Preferences are being restored; wait or reload if recovery is required"
    )
}

export class UncertainProfileCommitError extends Error {
  constructor() {
    super(
      "Preferences may already have been saved. Reload Rhema before continuing."
    )
    this.name = "UncertainProfileCommitError"
  }
}

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

type Change = ({ removed: true } | { removed: false; value: unknown }) & {
  generation: number
}

/** The existing stores keep their hydration/debounce APIs over one native profile. */
export async function openProfileSection(
  section: Section
): Promise<ProfileSectionStore> {
  await loadProfile()
  const staged = new Map<string, Change>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const change = staged.get(key)
      if (change && change.generation === generation)
        return change.removed ? undefined : (structuredClone(change.value) as T)
      if (change) staged.delete(key)
      const values = (await loadProfile()).sections[section]
      return Object.hasOwn(values, key)
        ? (structuredClone(values[key]) as T)
        : undefined
    },
    async set(key, value) {
      requireWritableProfile()
      staged.set(key, {
        removed: false,
        value: structuredClone(value),
        generation,
      })
    },
    async delete(key) {
      requireWritableProfile()
      staged.set(key, { removed: true, generation })
    },
    save(isCurrent) {
      if (profileFrozen)
        return Promise.reject(
          new Error("Preferences are blocked until restore completes or reload")
        )
      for (const [key, change] of staged)
        if (change.generation !== generation) staged.delete(key)
      if (staged.size === 0) return Promise.resolve()
      const capturedGeneration = generation
      const changes = new Map(staged)
      const discardCaptured = () => {
        for (const [key, change] of changes)
          if (staged.get(key) === change) staged.delete(key)
      }
      const saved = writes.then(async () => {
        const previous = await loadProfile()
        // Earlier sections may have held this save. Recheck the owner at the
        // shared dispatch boundary and discard canceled captured edits.
        if (capturedGeneration !== generation || (isCurrent && !isCurrent())) {
          discardCaptured()
          return
        }
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
        discardCaptured()
      })
      writes = saved.catch(() => {})
      return saved
    },
  }
}

/** Registered store flushes run first. Keep native commit and synchronous store
 * publication within the same exclusive queue item and maintenance lease. */
export async function restoreProfileAtomically(
  preferences: ResolvedPreferencesRestore,
  publish: (receipt: ProfileApplyReceipt) => void
): Promise<ProfileApplyReceipt> {
  requireWritableProfile()
  const request = ResolvedPreferencesSchema.parse(preferences)
  profileFrozen = true
  const saved = writes
    .then(async () => {
      const previous = await loadProfile()
      let response: unknown
      try {
        response = await invoke("apply_portable_preferences", {
          expectedRevision: previous.revision,
          preferences: request,
        })
      } catch {
        throw new UncertainProfileCommitError()
      }
      const rejected = RejectedSchema.safeParse(response)
      if (rejected.success) throw new Error(rejected.data.message)
      let receipt: ProfileApplyReceipt
      try {
        receipt = AppliedSchema.parse(response).receipt
        if (
          receipt.profile.revision !== previous.revision + 1 ||
          receipt.primary_translation_code !== request.primaryTranslationCode ||
          receipt.secondary_translation_code !==
            request.secondaryTranslationCode
        )
          throw new Error("Invalid profile restore acknowledgement")
      } catch {
        throw new UncertainProfileCommitError()
      }
      snapshot = receipt.profile
      generation++
      publishingRestoredProfile = true
      try {
        publish(receipt)
      } catch {
        throw new UncertainProfileCommitError()
      } finally {
        publishingRestoredProfile = false
      }
      profileFrozen = false
      return receipt
    })
    .catch((error: unknown) => {
      if (!(error instanceof UncertainProfileCommitError)) profileFrozen = false
      throw error
    })
  writes = saved.then(
    () => {},
    () => {}
  )
  return saved
}
