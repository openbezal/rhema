
export function Wordmark({
  size = "md",
}: {
  size?: "sm" | "md"
}) {
  const isSm = size === "sm"
  const textSize = isSm ? "text-lg" : "text-xl"
  const markSize = isSm ? 18 : 22

  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={markSize} />
      <span
        className={`font-display ${textSize} tracking-[-0.01em] text-paper-0 leading-none`}
        style={{ fontVariationSettings: '"SOFT" 40, "WONK" 0, "opsz" 48' }}
      >
        Rhema
      </span>
    </span>
  )
}

function LogoMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="block shrink-0"
    >
      <rect width="64" height="64" rx="14" fill="var(--color-ink-1)" />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="13"
        fill="none"
        stroke="var(--color-rule-strong)"
      />
      <circle cx="32" cy="32" r="10" fill="var(--color-live)" />
      <circle
        cx="32"
        cy="32"
        r="20"
        fill="none"
        stroke="var(--color-live)"
        strokeWidth="1.5"
        strokeOpacity="0.35"
      />
    </svg>
  )
}
