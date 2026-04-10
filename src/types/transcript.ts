export interface Word {
  text: string
  start: number
  end: number
  confidence: number
  punctuated: string
}

export interface TranscriptSegment {
  id: string
  text: string
  is_final: boolean
  confidence: number
  words: Word[]
  timestamp: number
}

export type TranscriptionBackend = "auto" | "local" | "deepgram"

export type TranscriptEventPayload =
  | {
      type: "partial"
      transcript: string
      words: Word[]
    }
  | {
      type: "final"
      transcript: string
      words: Word[]
      confidence: number
      utterance_id: string
    }
  | {
      type: "error"
      message: string
    }
  | {
      type: "connected"
    }
  | {
      type: "disconnected"
    }
