import type { SVGProps } from "react"

export function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 1.75a10.25 10.25 0 0 0-3.24 19.97c.51.09.7-.22.7-.5v-1.8c-2.85.62-3.45-1.21-3.45-1.21-.47-1.2-1.15-1.52-1.15-1.52-.94-.64.07-.63.07-.63 1.04.07 1.59 1.07 1.59 1.07.92 1.58 2.42 1.12 3.01.86.09-.67.36-1.13.66-1.39-2.28-.26-4.67-1.14-4.67-5.07 0-1.12.4-2.03 1.06-2.75-.11-.26-.46-1.3.1-2.72 0 0 .86-.28 2.83 1.05a9.77 9.77 0 0 1 5.15 0c1.97-1.33 2.83-1.05 2.83-1.05.56 1.42.21 2.46.1 2.72.66.72 1.06 1.63 1.06 2.75 0 3.94-2.4 4.81-4.68 5.06.37.32.7.95.7 1.91v2.83c0 .28.19.6.71.5A10.25 10.25 0 0 0 12 1.75Z"
      />
    </svg>
  )
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </svg>
  )
}
