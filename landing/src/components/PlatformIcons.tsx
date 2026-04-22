import type { SVGProps } from "react"

export function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M16.37 12.98c-.02-2.01 1.64-2.98 1.71-3.02-.93-1.36-2.39-1.55-2.91-1.57-1.24-.13-2.42.73-3.05.73-.64 0-1.6-.71-2.63-.69-1.35.02-2.6.78-3.3 1.98-1.4 2.43-.36 6.01 1.01 7.97.67.96 1.47 2.04 2.51 2 1.01-.04 1.39-.65 2.61-.65 1.22 0 1.56.65 2.63.63 1.09-.02 1.77-.98 2.44-1.94.77-1.11 1.09-2.19 1.11-2.25-.02-.01-2.12-.81-2.13-3.19ZM14.4 6.96c.56-.68.94-1.62.84-2.56-.81.03-1.8.54-2.38 1.22-.52.6-.98 1.58-.86 2.49.9.07 1.83-.46 2.4-1.15Z" />
    </svg>
  )
}

export function WindowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M3 5.5 11 4v7.5H3Zm0 7h8V20L3 18.5ZM12 3.75 21 2.5v9H12Zm0 8.75h9V21.5L12 20Z" />
    </svg>
  )
}

export function LinuxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M12 3.5c-2.2 0-3.8 2-3.8 4.6 0 1.8.8 2.9.8 4.4 0 1.1-1.7 2.5-2.2 4.1-.5 1.6.3 3.6 1.6 3.6.7 0 1.3-.5 2-.5s1.3.5 2.2.5c.9 0 1.5-.5 2.2-.5s1.3.5 2 .5c1.3 0 2.1-2 1.6-3.6-.5-1.6-2.2-3-2.2-4.1 0-1.5.8-2.6.8-4.4 0-2.6-1.6-4.6-3.8-4.6Z" />
      <circle cx="10.6" cy="8.4" r="0.55" fill="currentColor" />
      <circle cx="13.4" cy="8.4" r="0.55" fill="currentColor" />
    </svg>
  )
}
