import type { FC, SVGProps } from "react"
import {
  BroadcastIcon,
  CompassIcon,
  DetectIcon,
  LocalIcon,
  ScrollIcon,
  WaveformIcon,
} from "../components/FeatureIcons"

export interface Feature {
  id: string
  title: string
  body: string
  Icon: FC<SVGProps<SVGSVGElement>>
}

export const FEATURES: Feature[] = [
  {
    id: "live-transcription",
    title: "Live transcription",
    body: "Dual engines. Local Whisper for privacy, cloud Deepgram for zero-latency. Swap per room, per service.",
    Icon: WaveformIcon,
  },
  {
    id: "verse-detection",
    title: "Automatic verse detection",
    body: "Direct citations, quoted text, and semantic matches. On-device neural ranking catches the passage before you finish saying it.",
    Icon: DetectIcon,
  },
  {
    id: "broadcast",
    title: "NDI, HTTP & OSC output",
    body: "Send a verse to Resolume, OBS, vMix, TouchOSC, or a Stream Deck. First-class production integration, no glue scripts.",
    Icon: BroadcastIcon,
  },
  {
    id: "bible",
    title: "Offline Bible search",
    body: "12+ translations and 340k cross-references bundled locally. FTS5-indexed, full-text fast, no network hop.",
    Icon: ScrollIcon,
  },
  {
    id: "local-first",
    title: "Open source, local-first",
    body: "MIT-licensed Tauri desktop app. Your audio and sermon data never leave the machine unless you point Rhema at a cloud API.",
    Icon: LocalIcon,
  },
  {
    id: "tutorial",
    title: "Guided onboarding",
    body: "A skippable walkthrough shows each panel in situ so volunteers can go live in minutes without touching the docs.",
    Icon: CompassIcon,
  },
]
