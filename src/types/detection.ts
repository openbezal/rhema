export interface DetectionResult {
  verse_ref: string
  verse_text: string
  book_name: string
  book_number: number
  chapter: number
  verse: number
  confidence: number
  source: "direct" | "semantic"
  auto_queued: boolean
  transcript_snippet: string
}

export interface DetectionStatus {
  has_direct: boolean
  has_semantic: boolean
}

export interface SemanticSearchResult {
  verse_ref: string
  verse_text: string
  book_name: string
  book_number: number
  chapter: number
  verse: number
  similarity: number
}
