import type { Step } from "react-joyride"

export const TUTORIAL_STEPS: Step[] = [
  {
    target: '[data-slot="transcript-panel"]',
    title: "Live Transcript",
    content:
      'Click "Start transcript" to begin listening. Rhema converts speech to text in real time and highlights detected Bible verses.',
    placement: "right",
    disableBeacon: true,
  },
  {
    target: '[data-slot="detections-panel"]',
    title: "AI Detections",
    content:
      "Detected verses appear here. Press Present to display a verse on screen, or Queue to save it for later.",
    placement: "left",
  },
  {
    target: '[data-slot="search-panel"]',
    title: "Book Search",
    content:
      "Look up any Bible verse by book, chapter, and verse. Select a translation from the dropdown to switch versions.",
    placement: "top",
  },
  {
    target: '[data-slot="search-panel"]',
    title: "Context Search",
    content:
      'Switch to the Context tab to search by phrase or topic. Rhema uses AI to find verses that match what you\'re looking for.',
    placement: "top",
  },
  {
    target: '[data-slot="queue-panel"]',
    title: "Verse Queue",
    content:
      "Your queued verses live here. Drag to reorder, click to present. Build your set list before going live.",
    placement: "left",
  },
  {
    target: '[data-slot="preview-panel"]',
    title: "Programme Preview",
    content:
      "Preview how verses will look before sending them to the live output. What you see here is what your audience will see.",
    placement: "bottom",
  },
  {
    target: '[data-slot="live-output-panel"]',
    title: "Live Display",
    content:
      "This is the live broadcast output. When a verse is presented, it appears here and on any connected displays or NDI outputs.",
    placement: "bottom",
  },
  {
    target: '[data-tour="broadcast"]',
    title: "Broadcast",
    content:
      "Open broadcast settings to configure NDI output, display windows, and resolution for your live production setup.",
    placement: "bottom",
  },
  {
    target: '[data-tour="theme"]',
    title: "Themes",
    content:
      "Customize how verses look on screen. Choose from built-in themes or design your own with the visual editor.",
    placement: "bottom",
  },
  {
    target: '[data-tour="settings"]',
    title: "Settings",
    content:
      "Configure audio input, Bible translations, display mode, remote control, and API keys.",
    placement: "bottom",
  },
]
