import type { FC, SVGProps } from "react"
import { AppleIcon, LinuxIcon, WindowsIcon } from "../components/PlatformIcons"

export interface Platform {
  id: "macos" | "windows" | "linux"
  name: string
  /** Tiny subtitle — the artifact format users will get. */
  format: string
  /** When releases go live, set `available: true` and populate `downloadUrl`.
   *  That is the only change needed to flip this whole section out of the
   *  "Coming soon" state — no layout work. */
  available: boolean
  downloadUrl?: string
  Icon: FC<SVGProps<SVGSVGElement>>
}

export const PLATFORMS: Platform[] = [
  {
    id: "macos",
    name: "macOS",
    format: "Universal .dmg · Apple Silicon + Intel",
    available: false,
    Icon: AppleIcon,
  },
  {
    id: "windows",
    name: "Windows",
    format: "Signed .exe installer · x64",
    available: false,
    Icon: WindowsIcon,
  },
  {
    id: "linux",
    name: "Linux",
    format: ".AppImage · x64",
    available: false,
    Icon: LinuxIcon,
  },
]

export const RELEASE_STATE = {
  anyAvailable: PLATFORMS.some((p) => p.available),
  currentPhase: "First public release is in active development",
}
