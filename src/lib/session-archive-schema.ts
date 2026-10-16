import { z } from "zod"
import type { BroadcastTheme } from "@/types"
import { BookDisplayOverridesSchema } from "./book-display-names"

const number = z.number().finite()
const timestamp = number.min(0).max(8_640_000_000_000_000)
const text = z.string().max(200_000)
const name = z.string().min(1).max(512)
const color = z.string().min(1).max(128)
const code = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/)
const image = z.object({
  url: z
    .string()
    .max(28_000_000)
    .refine(
      (url) =>
        url === "" ||
        /^(data:image\/[a-zA-Z0-9.+-]+[;,]|https?:\/\/)/.test(url),
      "Use an embedded image or HTTP image URL"
    ),
  fit: z.enum(["cover", "contain", "stretch"]),
  blur: number.min(0).max(1000),
  brightness: number.min(0).max(1000),
  tint: color.nullable(),
})
const surface = z.object({
  enabled: z.boolean(),
  color,
  opacity: number.min(0).max(1),
  borderRadius: number.min(0).max(100_000),
  padding: number.min(0).max(100_000),
  image: image.nullable(),
})
const textAlignment = {
  horizontalAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  textTransform: z
    .enum(["none", "uppercase", "lowercase", "capitalize"])
    .optional(),
  textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
}
const font = {
  fontFamily: name,
  fontSize: number.positive().max(10_000),
  fontWeight: number.min(1).max(1000),
  color,
  ...textAlignment,
}
const verseStyle = z.object({
  ...font,
  lineHeight: number.positive().max(100),
  letterSpacing: number.min(-1000).max(1000),
  shadow: z
    .object({
      color,
      blur: number.min(0).max(1000),
      x: number.min(-100_000).max(100_000),
      y: number.min(-100_000).max(100_000),
    })
    .nullable(),
  outline: z.object({ color, width: number.min(0).max(1000) }).nullable(),
  surface: surface.optional(),
})
const box = z.object({
  x: number.min(-1000).max(1000),
  y: number.min(-1000).max(1000),
  width: number.positive().max(1000),
  height: number.positive().max(1000),
})
const theme: z.ZodType<BroadcastTheme> = z
  .object({
    id: name,
    name,
    builtin: z.literal(false),
    pinned: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    resolution: z.object({
      width: number.int().min(1).max(16_384),
      height: number.int().min(1).max(16_384),
    }),
    background: z.object({
      type: z.enum(["solid", "gradient", "image", "transparent"]),
      color,
      gradient: z
        .object({
          type: z.enum(["linear", "radial"]),
          angle: number.min(-3600).max(3600),
          stops: z
            .array(z.object({ color, position: number.min(0).max(100) }))
            .min(2)
            .max(100),
        })
        .nullable(),
      image: image.nullable(),
    }),
    textBox: surface,
    verseText: verseStyle,
    secondaryVerseText: verseStyle.partial().optional(),
    verseNumbers: z.object({
      visible: z.boolean(),
      fontSize: number.positive().max(10_000),
      color,
      superscript: z.boolean(),
    }),
    reference: z.object({
      ...font,
      uppercase: z.boolean(),
      includeVerseNumbers: z.boolean().optional(),
      letterSpacing: number.min(-1000).max(1000),
      position: z.enum(["above", "below", "inline"]),
      surface: surface.optional(),
    }),
    layout: z.object({
      anchor: z.enum([
        "center",
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ]),
      offsetX: number.min(-100_000).max(100_000),
      offsetY: number.min(-100_000).max(100_000),
      padding: z.object({
        top: number.min(0).max(100_000),
        right: number.min(0).max(100_000),
        bottom: number.min(0).max(100_000),
        left: number.min(0).max(100_000),
      }),
      textAlign: z.enum(["left", "center", "right"]),
      backgroundWidth: number.min(0).max(100_000),
      backgroundHeight: number.min(0).max(100_000),
      textAreaWidth: number.min(0).max(100_000),
      textAreaHeight: number.min(0).max(100_000),
      primaryShare: number.min(0).max(100).optional(),
      languageGap: number.min(0).max(100_000).optional(),
      referenceGap: number.min(0).max(100_000).optional(),
      mode: z.enum(["stacked", "free"]).optional(),
      referenceBox: box.optional(),
      verseBox: box.optional(),
      secondaryBox: box.optional(),
    }),
    transition: z.object({
      type: z.enum(["fade", "slide", "scale", "none"]),
      duration: number.min(0).max(60_000),
      easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
      direction: z.enum(["up", "down", "left", "right"]),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.layout.mode === "free" &&
      (!value.layout.referenceBox || !value.layout.verseBox)
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout"],
        message: "Free layout requires reference and verse boxes",
      })
  })

export const PortablePreferencesSchema = z.object({
  settings: z.object({
    gain: number.min(0).max(10),
    autoMode: z.boolean(),
    confidenceThreshold: number.min(0).max(1),
    cooldownMs: number.int().min(0).max(60_000),
    suggestionCapacity: number.int().min(1).max(100),
    suggestionRetentionMs: number.int().min(1000).max(300_000),
    sttProvider: z.enum(["deepgram", "whisper"]),
    bookDisplayOverrides: BookDisplayOverridesSchema.optional(),
  }),
  primaryTranslationCode: code.nullable(),
  secondaryTranslationCode: code.nullable(),
  followDetections: z.boolean(),
  autoLive: z.boolean(),
  customThemes: z.array(theme).max(1000),
})
const verse = z.object({
  bookNumber: number.int().min(1).max(66),
  bookName: name,
  chapter: number.int().min(1).max(200),
  verse: number.int().min(1).max(1000),
  text,
  translationCode: code.nullable(),
})
const detection = z.object({
  reference: name,
  verse,
  confidence: number.min(0).max(1),
  source: z.enum(["direct", "semantic"]),
  scoreKind: z.enum(["reference", "fts_rank", "cosine", "hybrid", "unknown"]),
  autoQueued: z.boolean(),
  transcriptSnippet: text,
  isChapterOnly: z.boolean(),
})
export const SessionArchiveSchema = z.object({
  kind: z.literal("rhema-session-archive"),
  version: z.literal(1),
  title: name,
  createdAt: timestamp,
  transcript: z
    .array(z.object({ text, timestamp, confidence: number.min(0).max(1) }))
    .max(100_000),
  queue: z
    .array(
      z.object({
        reference: name,
        verse,
        confidence: number.min(0).max(1),
        source: z.enum(["manual", "ai-direct", "ai-semantic", "ai-cloud"]),
        addedAt: timestamp,
        isChapterOnly: z.boolean(),
      })
    )
    .max(10_000),
  detectionScope: z.literal("current-snapshot"),
  detections: z.array(detection).max(1000),
  suggestions: z
    .array(detection.extend({ firstSeenAt: timestamp, lastSeenAt: timestamp }))
    .max(1000),
  preferences: PortablePreferencesSchema,
})
export const PreferencesDocumentSchema = z.object({
  kind: z.literal("rhema-preferences"),
  version: z.literal(1),
  createdAt: timestamp,
  preferences: PortablePreferencesSchema,
})
export const SessionDocumentSchema = z.discriminatedUnion("kind", [
  SessionArchiveSchema,
  PreferencesDocumentSchema,
])
export type SessionArchive = z.infer<typeof SessionArchiveSchema>
export type SessionDocument = z.infer<typeof SessionDocumentSchema>
