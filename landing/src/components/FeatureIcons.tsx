import type { SVGProps } from "react"


const defaults: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
}

export function WaveformIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M3 12h2" />
      <path d="M7 8v8" />
      <path d="M11 5v14" />
      <path d="M15 9v6" />
      <path d="M19 11v2" />
      <path d="M21 12h-2" />
    </svg>
  )
}

export function DetectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M7 4h-3v3" />
      <path d="M17 4h3v3" />
      <path d="M7 20h-3v-3" />
      <path d="M17 20h3v-3" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="4.8" opacity="0.45" />
    </svg>
  )
}

export function BroadcastIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4.5 9a5 5 0 0 1 0 6" />
      <path d="M7.5 6.5a9 9 0 0 1 0 11" />
      <path d="M19.5 9a5 5 0 0 0 0 6" />
      <path d="M16.5 6.5a9 9 0 0 0 0 11" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function ScrollIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 6v12a1 1 0 0 0 1 1h6V5H5a1 1 0 0 0-1 1Z" />
      <path d="M20 6v12a1 1 0 0 1-1 1h-6V5h6a1 1 0 0 1 1 1Z" />
      <path d="M7.5 9h1.5" />
      <path d="M7.5 12h2" />
      <path d="M15 9h1.5" />
      <path d="M15 12h2" />
    </svg>
  )
}

export function LocalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
      <path d="M10.5 10a1.5 1.5 0 1 1 3 0v1.2h-3Z" />
      <path d="M9.5 11.2h5v2.8h-5z" />
    </svg>
  )
}

export function CompassIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M15.5 8.5l-2 5-5 2 2-5Z" fill="currentColor" opacity="0.18" stroke="none" />
      <path d="M15.5 8.5l-2 5-5 2 2-5Z" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
