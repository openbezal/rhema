import { useEffect, useMemo, useRef, useState } from "react"
interface Phrase {
  words: string[]
  detectAtWord: number
  reference: string
  verseText: string
  source: "direct" | "semantic"
  confidence: number
}

const PHRASES: Phrase[] = [
  {
    words: [
      "and",
      "he",
      "said,",
      "whereunto",
      "shall",
      "we",
      "liken",
      "the",
      "kingdom",
      "of",
      "God?",
    ],
    detectAtWord: 9,
    reference: "Mark 4:30",
    verseText:
      "And he said, Whereunto shall we liken the kingdom of God? or with what comparison shall we compare it?",
    source: "semantic",
    confidence: 0.94,
  },
  {
    words: [
      "turning",
      "to",
      "John",
      "3:16,",
      "for",
      "God",
      "so",
      "loved",
      "the",
      "world",
    ],
    detectAtWord: 4,
    reference: "John 3:16",
    verseText:
      "For God so loved the world, that he gave his only begotten Son…",
    source: "direct",
    confidence: 0.99,
  },
  {
    words: [
      "the",
      "Lord",
      "is",
      "my",
      "shepherd",
      "—",
      "I",
      "shall",
      "not",
      "want.",
    ],
    detectAtWord: 6,
    reference: "Psalm 23:1",
    verseText: "The Lord is my shepherd; I shall not want.",
    source: "semantic",
    confidence: 0.97,
  },
]

const WORD_MS = 160
const POST_PHRASE_PAUSE_MS = 2800
const DETECTION_SHOW_MS = 2400

function useTypingCycle() {
  const [phraseIdx, setPhraseIdx] = useState(0)
  const [wordsShown, setWordsShown] = useState(0)
  const timeoutRef = useRef<number | null>(null)

  const phrase = PHRASES[phraseIdx]

  // Detection is derived from wordsShown — no separate state, no race.
  const detected = wordsShown >= phrase.detectAtWord

  useEffect(() => {
    const clear = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    if (wordsShown < phrase.words.length) {
      timeoutRef.current = window.setTimeout(() => {
        setWordsShown((n) => n + 1)
      }, WORD_MS)
      return clear
    }

    timeoutRef.current = window.setTimeout(() => {
      setWordsShown(0)
      setPhraseIdx((i) => (i + 1) % PHRASES.length)
    }, POST_PHRASE_PAUSE_MS + DETECTION_SHOW_MS)
    return clear
  }, [wordsShown, phrase.words.length])

  const partialText = useMemo(
    () => phrase.words.slice(0, wordsShown).join(" "),
    [phrase.words, wordsShown]
  )

  return {
    partialText,
    isTyping: wordsShown < phrase.words.length,
    detection: detected ? phrase : null,
  }
}

export function LiveTranscriptDemo() {
  const { partialText, isTyping, detection } = useTypingCycle()

  return (
    <div
      aria-hidden="true"
      className="
        relative isolate
        w-full overflow-hidden
        rounded-[calc(var(--radius)*1.5)]
        border border-rule-strong bg-ink-1/80
        shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]
        backdrop-blur-sm
      "
    >
      {/* Panel header — mimics Rhema's actual TranscriptPanel header */}
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <div className="flex items-center gap-2.5">
          <MicIcon className="size-3.5 text-paper-2" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-2">
            Live transcript
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="tally block size-1.5 rounded-full bg-live" />
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-2">
            Listening
          </span>
        </div>
      </div>

      <div className="relative flex min-h-[260px] flex-col justify-between gap-5 px-5 py-6 sm:min-h-[300px]">
        <div className="flex-1">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-paper-3">
            Partial
          </p>
          <p className="font-sans text-base leading-relaxed text-paper-0 sm:text-lg">
            {partialText}
            {isTyping && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-0.5 animate-pulse bg-live align-middle"
              />
            )}
          </p>
        </div>

        <div className="min-h-[82px]">
          {detection && (
            <div
              key={detection.reference}
              className="
                detection-enter relative overflow-hidden rounded-lg
                border border-live/30 bg-live/[0.04] px-4 py-3
              "
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      detection.source === "direct"
                        ? "font-mono text-[10px] uppercase tracking-[0.2em] text-live"
                        : "font-mono text-[10px] uppercase tracking-[0.2em] text-paper-2"
                    }
                  >
                    {detection.source === "direct" ? "Direct match" : "Semantic match"}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-3">
                    · {Math.round(detection.confidence * 100)}%
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-paper-3">
                  broadcast ↗
                </span>
              </div>

              <p
                className="mt-1.5 font-display text-xl leading-tight text-paper-0"
                style={{ fontVariationSettings: '"SOFT" 40, "WONK" 0, "opsz" 36' }}
              >
                {detection.reference}
              </p>

              <p className="mt-1 font-sans text-sm leading-snug text-paper-2 line-clamp-2">
                {detection.verseText}
              </p>
            </div>
          )}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-live/60 to-transparent"
      />
    </div>
  )
}

function MicIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v4" />
    </svg>
  )
}
