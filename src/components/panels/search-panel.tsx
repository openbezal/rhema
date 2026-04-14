import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { invoke } from "@tauri-apps/api/core"
// Using native overflow-y-auto instead of Radix ScrollArea for reliable scrolling in flex layouts
import { Button } from "@/components/ui/button"
import { getAutocompleteSuggestion, getTabNavigationResult } from "@/lib/quick-search"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  BookOpenIcon,
  SparklesIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useBible, bibleActions } from "@/hooks/use-bible"
import { useBibleStore, useQueueStore } from "@/stores"
import type { Book, Verse, SemanticSearchResult } from "@/types"
import { Input } from "@/components/ui/input"
import { searchContextWithFuse } from "@/lib/context-search"

type SearchTab = "book" | "context" 

/** Highlights words from the query that appear in the text. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>

  const queryWords = new Set(
    query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  )
  if (queryWords.size === 0) return <>{text}</>

  // Split text into words while preserving whitespace/punctuation
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        const cleaned = part.toLowerCase().replace(/[^a-z']/g, "")
        if (cleaned.length >= 2 && queryWords.has(cleaned)) {
          return (
            <mark key={i} className="rounded-[2px] bg-emerald-800/90 px-0.5 text-foreground">
              {part}
            </mark>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

export function SearchPanel() {
  const [activeTab, setActiveTab] = useState<SearchTab>("book")
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [chapter, setChapter] = useState(1)
  const [selectedVerseId, setSelectedVerseId] = useState<number | null>(null)
  const [contextQuery, setContextQuery] = useState("")

  // EasyWorship-style autocomplete
  const [quickInput, setQuickInput] = useState("")
  const [showQuickVerses, setShowQuickVerses] = useState(false)
  const [quickVersesList, setQuickVersesList] = useState<Verse[]>([])

  const quickInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const {
    translations,
    books,
    currentChapter,
    semanticResults,
    activeTranslationId,
    selectedVerse,
  } = useBible()

  const queueItems = useQueueStore((s) => s.items)
  const queuedVerseKeys = useMemo(() => {
    return new Set(
      queueItems.map((item) => `${item.verse.book_number}:${item.verse.chapter}:${item.verse.verse}`)
    )
  }, [queueItems])

  const selectedBookNumber = selectedBook?.book_number

  // Load initial data and default to Genesis 1:1
  useEffect(() => {
    bibleActions.loadTranslations().catch(console.error)
    bibleActions.loadBooks().then(() => {
      useBibleStore.getState().setPendingNavigation({
        bookNumber: 1,
        chapter: 1,
        verse: 1,
      })
    }).catch(console.error)
  }, [])

  // Load chapter when book + chapter are set
  useEffect(() => {
    if (selectedBookNumber && chapter >= 1) {
      bibleActions.loadChapter(selectedBookNumber, chapter).catch(console.error)
    }
  }, [selectedBookNumber, chapter, activeTranslationId])

  const effectiveSelectedVerseId = useMemo(() => {
    if (!selectedVerseId || currentChapter.length === 0) return null
    if (currentChapter.some((v) => v.id === selectedVerseId)) return selectedVerseId
    if (!selectedVerse) return null
    return currentChapter.find((v) => v.verse === selectedVerse.verse)?.id ?? null
  }, [currentChapter, selectedVerseId, selectedVerse])

  // After chapter reloads (e.g., translation change), re-select by verse number
  useEffect(() => {
    if (!selectedVerseId || !selectedVerse || currentChapter.length === 0) return
    const stillExists = currentChapter.some((v) => v.id === selectedVerseId)
    if (!stillExists) {
      const match = currentChapter.find((v) => v.verse === selectedVerse.verse)
      if (match && match.id !== selectedVerse.id) {
        bibleActions.selectVerse(match)
      }
    }
  }, [currentChapter, selectedVerseId, selectedVerse])

  const applyNavigationSelection = useCallback(
    (book: Book, navChapter: number) => {
      setActiveTab("book")
      setSelectedBook(book)
      setChapter(navChapter)
    },
    []
  )

  // Auto-navigate when a detection or "Present" click sets pendingNavigation
  useEffect(() => {
    let lastHandledKey: string | null = null

    const unsubscribe = useBibleStore.subscribe((state) => {
      const pendingNavigation = state.pendingNavigation
      if (!pendingNavigation) {
        lastHandledKey = null
        return
      }

      const { bookNumber, chapter: navChapter, verse: navVerse } = pendingNavigation
      const pendingKey = `${bookNumber}:${navChapter}:${navVerse}`
      if (pendingKey === lastHandledKey) return

      const book = state.books.find((b) => b.book_number === bookNumber)
      if (!book) return

      lastHandledKey = pendingKey
      applyNavigationSelection(book, navChapter)

      // Load chapter explicitly, then select + scroll to the verse.
      bibleActions.loadChapter(bookNumber, navChapter).then((verses) => {
        const target = verses.find((v) => v.verse === navVerse)
        if (target) {
          setSelectedVerseId(target.id)
          bibleActions.selectVerse(target)
          document
            .getElementById(`verse-${target.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" })
        }
        panelRef.current?.focus()
      }).catch(console.error).finally(() => {
        useBibleStore.getState().setPendingNavigation(null)
      })
    })

    return unsubscribe
  }, [applyNavigationSelection])

  const handleVerseClick = useCallback((verse: Verse) => {
    setSelectedVerseId(verse.id)
    bibleActions.selectVerse(verse)
  }, [])

  // Arrow key navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        if (chapter > 1) {
          setChapter((c) => c - 1)
            setSelectedVerseId(null)
        }
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        setChapter((c) => c + 1)
        setSelectedVerseId(null)
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        if (currentChapter.length === 0) return
        const currentIdx = effectiveSelectedVerseId
          ? currentChapter.findIndex((v) => v.id === effectiveSelectedVerseId)
          : -1
        const nextIdx = Math.min(currentIdx + 1, currentChapter.length - 1)
        const next = currentChapter[nextIdx]
        if (next) {
          setSelectedVerseId(next.id)
          bibleActions.selectVerse(next)
          document
            .getElementById(`verse-${next.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (currentChapter.length === 0) return
        const currentIdx = effectiveSelectedVerseId
          ? currentChapter.findIndex((v) => v.id === effectiveSelectedVerseId)
          : currentChapter.length
        const prevIdx = Math.max(currentIdx - 1, 0)
        const prev = currentChapter[prevIdx]
        if (prev) {
          setSelectedVerseId(prev.id)
          bibleActions.selectVerse(prev)
          document
            .getElementById(`verse-${prev.id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
      }
    },
    [chapter, currentChapter, effectiveSelectedVerseId]
  )

  // Context search — hybrid backend (vector + FTS5 BM25) as primary,
  // Fuse.js fallback when semantic model is not loaded.
  const contextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextSearchRequestIdRef = useRef(0)

  const runContextSearch = useCallback(async (query: string, translationId: number) => {
    const requestId = ++contextSearchRequestIdRef.current
    const isStale = () => requestId !== contextSearchRequestIdRef.current

    // Primary: hybrid search backend (combines vector + FTS5 BM25)
    const hybridResults = await invoke<SemanticSearchResult[]>(
      "semantic_search", { query, limit: 15 }
    ).catch(() => null)

    if (isStale()) return

    if (hybridResults && hybridResults.length > 0) {
      useBibleStore.getState().setSemanticResults(hybridResults)
      return
    }

    // Fallback: client-side Fuse.js when semantic model is not loaded
    const fuseResults = await searchContextWithFuse(query, translationId, 15).catch(() => [])
    if (isStale()) return
    useBibleStore.getState().setSemanticResults(fuseResults)
  }, [])

  const handleContextSearch = useCallback((query: string) => {
    setContextQuery(query)
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    if (query.length >= 5) {
      const translationId = useBibleStore.getState().activeTranslationId
      contextDebounceRef.current = setTimeout(() => {
        runContextSearch(query, translationId).catch(console.error)
      }, 280)
    } else {
      contextSearchRequestIdRef.current += 1
      useBibleStore.getState().setSemanticResults([])
    }
  }, [runContextSearch])

  useEffect(() => {
    if (activeTab !== "context" || contextQuery.length < 5) return
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    contextDebounceRef.current = setTimeout(() => {
      runContextSearch(contextQuery, activeTranslationId).catch(console.error)
    }, 120)
  }, [activeTranslationId, activeTab, contextQuery, runContextSearch])

  useEffect(() => {
    return () => {
      if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    }
  }, [])

  // Derive autocomplete suggestion during render (no setState cascading)
  const autocompleteResult = useMemo(
    () => getAutocompleteSuggestion(quickInput, books),
    [quickInput, books]
  )
  const quickSuggestion = autocompleteResult.suggestion

  // Side effects only: navigation + verse loading
  useEffect(() => {
    const result = autocompleteResult

    if (result.matchedBook && result.chapter && result.verse) {
      useBibleStore.getState().setPendingNavigation({
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter,
        verse: result.verse
      })

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (quickInputRef.current && document.activeElement !== quickInputRef.current) {
            quickInputRef.current.focus()
          }
        })
      })
    }

    if ((result.stage === "chapter" || result.stage === "verse") && result.matchedBook && result.chapter) {
      invoke<Verse[]>("get_chapter", {
        translationId: activeTranslationId,
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter
      }).then(verses => {
        setQuickVersesList(verses)
        setShowQuickVerses(true)
      }).catch(console.error)
    }
  }, [autocompleteResult, activeTranslationId])

  // Derive dropdown visibility: only show when autocomplete stage is chapter/verse
  const shouldShowVerseDropdown = showQuickVerses
    && (autocompleteResult.stage === "chapter" || autocompleteResult.stage === "verse")

  const handleQuickKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab or → accepts suggestion and advances to NEXT STAGE
    if ((e.key === "Tab" || e.key === "ArrowRight") && quickSuggestion && quickSuggestion !== quickInput) {
      e.preventDefault()
      const nextInput = getTabNavigationResult(quickInput, quickSuggestion)
      setQuickInput(nextInput)
      return
    }

    // Enter clears input (verse is already showing in panel)
    if (e.key === "Enter") {
      e.preventDefault()
      setQuickInput("")
      setShowQuickVerses(false)
      return
    }

    // Escape clears
    if (e.key === "Escape") {
      e.preventDefault()
      setQuickInput("")
      setShowQuickVerses(false)
      return
    }
  }, [quickInput, quickSuggestion])

  const handleQuickVerseClick = useCallback((verse: Verse) => {
    useBibleStore.getState().setPendingNavigation({
      bookNumber: verse.book_number,
      chapter: verse.chapter,
      verse: verse.verse
    })
    setQuickInput("")
    setShowQuickVerses(false)
  }, [])

  return (
    <div
      ref={panelRef}
      data-slot="search-panel"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card outline-none"
      onKeyDown={activeTab === "book" ? handleKeyDown : undefined}
      tabIndex={-1}
    >
      {/* STICKY: Tab row + search input */}
      <div className="flex shrink-0 items-center gap-0 border-b border-border min-h-11">
        <div className="flex items-center gap-1 px-3 py-1.5">
          
          <button
            data-tour="book-search"
            onClick={() => setActiveTab("book")}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === "book"
                ? "border-lime-500/50 bg-lime-500/15 "
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <BookOpenIcon className={cn("size-3.5", activeTab === "book" ? "text-lime-400" : "text-muted-foreground")} />
            Book search
          </button>
          <button
            data-tour="context-search"
            onClick={() => {
              setActiveTab("context")
              setContextQuery("")
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === "context"
                ? "border-lime-500/50 bg-lime-500/15"
                : "border-border bg-background  text-muted-foreground hover:text-foreground"
            )}
          >
            <SparklesIcon className={cn("size-3.5", activeTab === "context" ? "text-lime-400" : "text-muted-foreground")} />
            Context search
          </button>
        </div>

        {activeTab === "book" ? (
          <div className="flex flex-1 items-center gap-2 pr-3">
            {/* EasyWorship-style autocomplete */}
            <div className="relative flex-1">
              {/* Suggestion overlay */}
              {quickSuggestion && quickSuggestion !== quickInput && (
                <div className="absolute inset-0 flex items-center px-3 pointer-events-none z-10">
                  <span className="text-xs font-normal">
                    <span className="text-foreground">{quickInput}</span>
                    <span className="text-gray-500 dark:text-gray-400">{quickSuggestion.slice(quickInput.length)}</span>
                  </span>
                </div>
              )}

              {/* Actual input */}
              <Input
                ref={quickInputRef}
                data-tour="quick-nav"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyDown={handleQuickKeyDown}
                placeholder="Type: J → John 3:16"
                className={cn(
                  "h-7 text-xs relative bg-background",
                  quickSuggestion && quickSuggestion !== quickInput ? "text-transparent" : ""
                )}
                style={quickSuggestion && quickSuggestion !== quickInput ? {
                  caretColor: 'var(--foreground)'
                } : undefined}
              />

              {/* Verse dropdown */}
              {shouldShowVerseDropdown && quickVersesList.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                  <div className="p-1">
                    {quickVersesList.map((verse) => (
                      <button
                        key={verse.id}
                        onClick={() => handleQuickVerseClick(verse)}
                        className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="shrink-0 font-semibold text-primary w-6 text-right">
                          {verse.verse}
                        </span>
                        <span className="flex-1 text-muted-foreground line-clamp-1">
                          {verse.text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Select
              value={String(activeTranslationId)}
              onValueChange={async (v) => {
                const id = Number(v)
                try {
                  await invoke("set_active_translation", { translationId: id })
                  useBibleStore.getState().setActiveTranslation(id)
                } catch (err) { console.error(err) }
              }}
            >
              <SelectTrigger size="sm" className="h-7 w-[72px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {translations.map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.abbreviation}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-1 items-center gap-2 pr-3">
            <Input
              placeholder="Search verse text..."
              value={contextQuery}
              onChange={(e) => handleContextSearch(e.target.value)}
              className="h-7 flex-1 text-xs"
            />
              <Select
                value={String(activeTranslationId)}
                onValueChange={async (v) => {
                  const id = Number(v)
                  try {
                    await invoke("set_active_translation", { translationId: id })
                    useBibleStore.getState().setActiveTranslation(id)
                  } catch (err) { console.error(err) }
                }}
              >
                <SelectTrigger size="sm" className="h-7 w-[72px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {translations.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.abbreviation}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
        )}
      </div>

      {/* Quick nav tab */}
      

      {/* Book search tab */}
      {activeTab === "book" && (
        <>
          {/* STICKY: Chapter header */}

          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2 min-h-9">
            {selectedBook ?
              <h3 className="text-sm font-semibold text-foreground">
                {selectedBook.name} {chapter}
              </h3> : null}
            {selectedBook ? <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  if (chapter > 1) {
                    setChapter((c) => c - 1)
                                setSelectedVerseId(null)
                  }
                }}
                disabled={chapter <= 1}
              >
                <ArrowLeftIcon className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setChapter((c) => c + 1)
                            setSelectedVerseId(null)
                }}
              >
                <ArrowRightIcon className="size-3" />
              </Button>
            </div> : null}
          </div>


          {/* SCROLLABLE: Verse list only */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-0 p-2">
              {currentChapter.map((verse) => (
                <div
                  key={verse.id}
                  id={`verse-${verse.id}`}
                  onClick={() => handleVerseClick(verse)}
                  className={cn(
                    "group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors",
                    verse.id === effectiveSelectedVerseId
                      ? "border border-lime-500/50 bg-lime-500/10"
                      : "border border-transparent hover:bg-muted/50"
                  )}
                >
                  <span className="w-6 shrink-0 text-right text-sm font-semibold text-primary">
                    {verse.verse}
                  </span>
                  <p className="flex-1 text-sm leading-relaxed text-foreground/80">
                    {verse.text}
                  </p>
                  {queuedVerseKeys.has(`${verse.book_number}:${verse.chapter}:${verse.verse}`) ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="flex size-6 shrink-0 cursor-pointer items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation()
                              const store = useQueueStore.getState()
                              const idx = store.findDuplicate(verse.book_number, verse.chapter, verse.verse)
                              if (idx !== -1) {
                                store.flashItem(store.items[idx].id)
                                document.querySelector(`[data-slot="queue-panel"] [data-queue-idx="${idx}"]`)
                                  ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                              }
                            }}
                          >
                            <CheckIcon className="size-4 text-ai-direct" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">Already in queue</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className={cn(
                              "shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                              verse.id === effectiveSelectedVerseId
                                ? "hover:bg-lime-500/20 hover:text-lime-500"
                                : "bg-primary/40! text-primary-foreground hover:bg-primary!"
                            )}
                            onClick={(e) => {
                              e.stopPropagation()
                              useQueueStore.getState().addItem({
                                id: crypto.randomUUID(),
                                verse,
                                reference: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
                                confidence: 1,
                                source: "manual",
                                added_at: Date.now(),
                              })
                            }}
                          >
                            <PlusIcon className="size-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">Add to queue</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Context search tab — semantic AI search */}
      {activeTab === "context" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0 p-2">
            {contextQuery.length < 5 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                Search by meaning — type a phrase, paraphrase, or topic...
              </p>
            )}
            {contextQuery.length >= 5 && semanticResults.length === 0 && (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No results found
              </p>
            )}
            {semanticResults.map((result, idx) => (
              <div
                key={`${result.book_number}-${result.chapter}-${result.verse}-${idx}`}
                onClick={() => {
                  bibleActions.selectVerse({
                    id: 0,
                    translation_id: activeTranslationId,
                    book_number: result.book_number,
                    book_name: result.book_name,
                    book_abbreviation: "",
                    chapter: result.chapter,
                    verse: result.verse,
                    text: result.verse_text,
                  })
                }}
                className="group flex flex-col cursor-pointer gap-1 rounded-lg p-3 transition-colors hover:bg-muted/50 relative"
              >
                <div className="flex shrink-0 flex-row items-start gap-2">
                  <span className="text-xs font-semibold ">
                    {result.book_name}   {result.chapter}:{result.verse}
                  </span>
                  <span
                    className="mt-0.5 text-[0.5rem] text-muted-foreground"
                  >
                    {Math.round(result.similarity * 100)}%
                  </span>
                </div>
                <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                  <HighlightedText text={result.verse_text} query={contextQuery} />
                </p>
                {queuedVerseKeys.has(`${result.book_number}:${result.chapter}:${result.verse}`) ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="flex size-6 absolute right-2 top-1/2 -translate-y-1/2 shrink-0 cursor-pointer items-center justify-center"
                          onClick={(e) => {
                            e.stopPropagation()
                            const store = useQueueStore.getState()
                            const idx = store.findDuplicate(result.book_number, result.chapter, result.verse)
                            if (idx !== -1) {
                              store.flashItem(store.items[idx].id)
                              document.querySelector(`[data-slot="queue-panel"] [data-queue-idx="${idx}"]`)
                                ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                            }
                          }}
                        >
                          <CheckIcon className="size-4 text-ai-direct" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left">Already in queue</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity bg-primary text-primary-foreground hover:bg-primary/80"
                          onClick={(e) => {
                            e.stopPropagation()
                            useQueueStore.getState().addItem({
                              id: crypto.randomUUID(),
                              verse: {
                                id: 0,
                                translation_id: activeTranslationId,
                                book_number: result.book_number,
                                book_name: result.book_name,
                                book_abbreviation: "",
                                chapter: result.chapter,
                                verse: result.verse,
                                text: result.verse_text,
                              },
                              reference: `${result.book_name} ${result.chapter}:${result.verse}`,
                              confidence: result.similarity,
                              source: "manual",
                              added_at: Date.now(),
                            })
                          }}
                        >
                          <PlusIcon className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">Add to queue</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
