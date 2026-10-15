import type { Step } from "react-joyride"

const STEP_DEFAULTS = {
  skipBeacon: true,
} as const satisfies Partial<Step>

export const TUTORIAL_STEPS: Step[] = [
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="transcript-panel"]',
    title: "Live Transcript",
    content:
      "Start transcribing to convert speech to text in real time. Detections continue while panels are hidden.",
    placement: "right",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="detections-panel"]',
    title: "Direct detections",
    content:
      "Spoken references appear here. Present sends a verified verse to the audience; Queue saves it for later.",
    placement: "left",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="suggestions-panel"]',
    title: "Suggestions",
    content:
      "Quotation matches retain a stable list while you inspect them. Apply updates when ready to see new matches. Keyword search scores are not similarity percentages.",
    placement: "left",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="book-search"]',
    title: "Book Search",
    content:
      "Look up any verse by book, chapter, and number. Follow lets detections navigate this panel; keep it off while browsing manually.",
    placement: "bottom",
    spotlightPadding: 2,
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="context-search"]',
    title: "Context Search",
    content:
      "Search by phrase or topic. Rhema uses AI to find matching verses.",
    placement: "bottom",
    spotlightPadding: 2,
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="quick-nav"]',
    title: "Quick Navigation",
    content:
      "Type to instantly navigate: 'J' → 'Joshua' or '1 J' → '1 John', press Tab to advance stages, then type chapter and verse.",
    placement: "bottom",
    spotlightPadding: 2,
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="queue-panel"]',
    title: "Verse Queue",
    content:
      "Your queued verses live here. Drag to reorder, click to present. Build your set list before going live.",
    placement: "left",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="preview-panel"]',
    title: "Programme Preview",
    content:
      "Preview the browsed verse. It can differ from live output; Present sends your choice to the audience.",
    placement: "bottom",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-slot="live-output-panel"]',
    title: "Live Display",
    content:
      "Presented verses appear here and on connected outputs. Auto presents detected verses independently of Follow. The eraser clears content without stopping outputs.",
    placement: "bottom",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="broadcast"]',
    title: "Broadcast",
    content:
      "Configure NDI output, display windows, and resolution for your production setup.",
    placement: "bottom",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="theme"]',
    title: "Themes",
    content:
      "Choose from built-in themes or design your own with the visual editor.",
    placement: "bottom",
  },
  {
    ...STEP_DEFAULTS,
    target: '[data-tour="settings"]',
    title: "Settings",
    content:
      "Configure audio input, Bible translations, display mode, remote control, and API keys.",
    placement: "bottom",
  },
]
