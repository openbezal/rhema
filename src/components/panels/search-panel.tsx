import { revealVerseInList } from "@/lib/verse-reveal"
import { useOperatorUiStore } from "@/lib/operator-ui"
import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react"
import { invoke } from "@tauri-apps/api/core"
// Using native overflow-y-auto instead of Radix ScrollArea for reliable scrolling in flex layouts
import { Button } from "@/components/ui/button"
import {
  getAutocompleteSuggestion,
  getAutocompleteSuffix,
  getTabNavigationResult,
  parseTypedReference,
  completeTypedReferenceInput,
} from "@/lib/quick-search"
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
import { useBible, bibleActions, findLoadedVerse } from "@/hooks/use-bible"
import { presentVerse } from "@/hooks/use-broadcast"
import { activateTranslation } from "@/stores/bible-store"
import { operatorActions } from "@/lib/operator-actions"
import { Switch } from "@/components/ui/switch"
import { useBibleStore, useQueueStore } from "@/stores"
import type { Book, Verse, SemanticSearchResult } from "@/types"
import { Input } from "@/components/ui/input"
import { searchContextWithFuse } from "@/lib/context-search"
import {
  isOperatorMaintenanceActive,
  isOperatorWorkCurrent,
  operatorRevision,
  useOperatorMaintenanceStore,
} from "@/lib/operator-maintenance"

type SearchTab = "book" | "context"

const RESULT_SOURCE_STYLES: Record<string, { text: string; label: string }> = {
  reference: { text: "text-amber-500", label: "Reference" },
  keyword: { text: "text-green-600", label: "Keyword" },
  semantic: { text: "text-indigo-300", label: "Semantic" },
}

/**
 * Source badges for a search result, with a real cosine percentage shown
 * only on semantic hits. Keyword ranks come from BM25 and reference hits
 * are exact — neither has an honest percentage to show.
 */
function ResultSourceBadges({ result }: { result: SemanticSearchResult }) {
  const sources = result.sources?.length ? result.sources : ["keyword"]
  return (
    <span className="mt-0.5 flex items-center gap-1">
      {sources.map((source) => {
        const style = RESULT_SOURCE_STYLES[source]
        if (!style) return null
        return (
          <span
            key={source}
            className={cn(
              "text-[0.5rem] font-medium tracking-wider uppercase",
              style.text
            )}
          >
            {style.label}
          </span>
        )
      })}
      {result.sources?.includes("semantic") && (
        <span className="text-[0.5rem] text-muted-foreground">
          {Math.round(result.similarity * 100)}%
        </span>
      )}
    </span>
  )
}

/** Highlights words from the query that appear in the text. */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>

  const queryWords = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2)
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
            <mark
              key={i}
              className="rounded-[2px] bg-emerald-800/90 px-0.5 text-foreground"
            >
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
  const maintenancePhase = useOperatorMaintenanceStore((state) => state.phase)
  const [activeTab, setActiveTab] = useState<SearchTab>("book")
  const [selectedBook, setSelectedBook] = useState<Book | null>(() => {
    const state = useBibleStore.getState()
    const bookNumber = state.currentChapter[0]?.book_number
    return state.books.find((book) => book.book_number === bookNumber) ?? null
  })
  const [chapter, setChapter] = useState(
    () => useBibleStore.getState().currentChapter[0]?.chapter ?? 1
  )
  const [contextQuery, setContextQuery] = useState("")

  // EasyWorship-style autocomplete
  const [quickInput, setQuickInput] = useState("")
  const [quickEditRevision, setQuickEditRevision] = useState(0)
  const [quickComposing, setQuickComposing] = useState(false)
  const quickOriginTranslationRef = useRef(
    useBibleStore.getState().activeTranslationId
  )
  const handledQuickEditRef = useRef(-1)
  const editQuickInput = useCallback((input: string) => {
    quickOriginTranslationRef.current =
      useBibleStore.getState().activeTranslationId
    setQuickInput(input)
    setQuickEditRevision((revision) => revision + 1)
  }, [])
  const [showQuickVerses, setShowQuickVerses] = useState(false)
  const [quickVersesList, setQuickVersesList] = useState<Verse[]>([])
  const [quickVerseRequest, setQuickVerseRequest] = useState("")

  const quickInputRef = useRef<HTMLInputElement>(null)
  const searchFocusRevision = useOperatorUiStore(
    (state) => state.searchFocusRevision
  )
  const focusedSearchRevision = useRef(searchFocusRevision)
  useEffect(
    () =>
      useOperatorUiStore.subscribe((state, previous) => {
        if (state.searchFocusRevision !== previous.searchFocusRevision)
          setActiveTab("book")
      }),
    []
  )
  useLayoutEffect(() => {
    if (searchFocusRevision === focusedSearchRevision.current) return
    if (activeTab !== "book") return
    focusedSearchRevision.current = searchFocusRevision
    quickInputRef.current?.focus()
    quickInputRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [searchFocusRevision, activeTab])

  const panelRef = useRef<HTMLDivElement>(null)

  const {
    translations,
    books,
    currentChapter,
    semanticResults,
    activeTranslationId,
    selectedVerse,
  } = useBible()

  const followDetections = useBibleStore((s) => s.followDetections)
  const queueItems = useQueueStore((s) => s.items)
  const queuedVerseKeys = useMemo(() => {
    return new Set(
      queueItems.map(
        (item) =>
          `${item.verse.book_number}:${item.verse.chapter}:${item.verse.verse}`
      )
    )
  }, [queueItems])

  const selectedBookNumber = selectedBook?.book_number

  // Load chapter when book + chapter are set
  useEffect(() => {
    if (isOperatorMaintenanceActive()) return
    if (selectedBookNumber && chapter >= 1) {
      const state = useBibleStore.getState()
      const loaded = state.currentChapter[0]
      if (
        state.pendingNavigation ||
        (loaded?.book_number === selectedBookNumber &&
          loaded.chapter === chapter &&
          loaded.translation_id === activeTranslationId)
      )
        return
      bibleActions.loadChapter(selectedBookNumber, chapter).catch(console.error)
    }
  }, [selectedBookNumber, chapter, activeTranslationId, maintenancePhase])

  // The highlight follows the store, not component state, so a remote command
  // or a keyboard shortcut moves it just as a click does. Matching on
  // book/chapter/verse is also what drops the highlight when the operator
  // changes chapter — the selected verse no longer belongs to what's on screen.
  const effectiveSelectedVerseId = useMemo(
    () =>
      findLoadedVerse(
        currentChapter,
        selectedVerse
          ? {
              bookNumber: selectedVerse.book_number,
              chapter: selectedVerse.chapter,
              verse: selectedVerse.verse,
            }
          : null
      )?.id ?? null,
    [currentChapter, selectedVerse]
  )

  // The one place a verse row is scrolled into view. Driven by an explicit
  // reveal request rather than by `selectedVerse`, because `presentVerse`
  // selects a verse on every auto-live detection and must not drag the
  // operator's scroll position around mid-service.
  const revealRequest = useBibleStore((s) => s.revealRequest)
  useEffect(() => {
    if (revealRequest === 0) return
    const {
      selectedVerse: target,
      currentChapter: chapterVerses,
      revealBlock,
    } = useBibleStore.getState()
    const row = findLoadedVerse(
      chapterVerses,
      target
        ? {
            bookNumber: target.book_number,
            chapter: target.chapter,
            verse: target.verse,
          }
        : null
    )
    if (!row) return
    const element = document.getElementById(`verse-${row.id}`)
    if (element) revealVerseInList(element, revealBlock)
  }, [revealRequest])

  const applyNavigationSelection = useCallback(
    (book: Book, navChapter: number) => {
      setActiveTab("book")
      setSelectedBook(book)
      setChapter(navChapter)
    },
    []
  )

  // The app controller loads and selects; this subscriber only follows its
  // completed reveal requests in the visible panel.
  useEffect(
    () =>
      useBibleStore.subscribe((state, previous) => {
        if (
          state.revealRequest === previous.revealRequest ||
          state.revealBlock !== "center"
        )
          return
        const target = state.selectedVerse
        const book = state.books.find(
          (book) => book.book_number === target?.book_number
        )
        if (!target || !book) return
        applyNavigationSelection(book, target.chapter)
      }),
    [applyNavigationSelection]
  )

  const handleVerseClick = useCallback((verse: Verse) => {
    bibleActions.selectVerse(verse)
    void presentVerse(verse)
  }, [])

  // Context search — hybrid backend (vector + FTS5 BM25) as primary,
  // Fuse.js fallback when semantic model is not loaded.
  const contextDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextSearchRequestIdRef = useRef(0)

  useEffect(
    () =>
      useOperatorMaintenanceStore.subscribe((state) => {
        if (state.phase === "idle") return
        contextSearchRequestIdRef.current += 1
        if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
        contextDebounceRef.current = null
        // Do not replay an old typed intent when the restored catalog arrives.
        setContextQuery("")
        setQuickInput("")
        setQuickComposing(false)
        setShowQuickVerses(false)
        setQuickVersesList([])
      }),
    []
  )

  const runContextSearch = useCallback(
    async (query: string, translationId: number) => {
      const epoch = operatorRevision()
      if (!isOperatorWorkCurrent(epoch)) return
      const requestId = ++contextSearchRequestIdRef.current
      const isStale = () =>
        requestId !== contextSearchRequestIdRef.current ||
        !isOperatorWorkCurrent(epoch) ||
        useBibleStore.getState().activeTranslationId !== translationId

      // A fully-typed reference ("John 3:16", "jn 3 16", "1 cor 13:4") pins
      // the exact verse at the top; hybrid search still runs beneath it.
      let referenceResult: SemanticSearchResult | null = null
      const reference = parseTypedReference(
        query,
        useBibleStore.getState().books
      )
      if (reference) {
        const verse = await invoke<Verse | null>("get_verse", {
          translationId,
          bookNumber: reference.book.book_number,
          chapter: reference.chapter,
          verse: reference.verse,
        }).catch(() => null)
        if (isStale()) return
        if (verse) {
          referenceResult = {
            verse_ref: `${verse.book_name} ${verse.chapter}:${verse.verse}`,
            verse_text: verse.text,
            book_name: verse.book_name,
            book_number: verse.book_number,
            chapter: verse.chapter,
            verse: verse.verse,
            similarity: 1,
            sources: ["reference"],
          }
        }
      }

      const pinReference = (results: SemanticSearchResult[]) => {
        if (!referenceResult) return results
        const pinned = referenceResult
        return [
          pinned,
          ...results.filter(
            (r) =>
              r.book_number !== pinned.book_number ||
              r.chapter !== pinned.chapter ||
              r.verse !== pinned.verse
          ),
        ]
      }

      // Primary: hybrid search backend (combines vector + FTS5 BM25)
      const hybridResults = await invoke<SemanticSearchResult[]>(
        "semantic_search",
        { query, limit: 15 }
      ).catch(() => null)

      if (isStale()) return

      if ((hybridResults && hybridResults.length > 0) || referenceResult) {
        useBibleStore
          .getState()
          .setSemanticResults(pinReference(hybridResults ?? []))
        return
      }

      // Fallback: client-side Fuse.js when semantic model is not loaded
      const fuseResults = await searchContextWithFuse(
        query,
        translationId,
        15
      ).catch(() => [])
      if (isStale()) return
      useBibleStore.getState().setSemanticResults(pinReference(fuseResults))
    },
    []
  )

  const handleContextSearch = useCallback(
    (query: string) => {
      if (isOperatorMaintenanceActive()) return
      setContextQuery(query)
      contextSearchRequestIdRef.current += 1
      if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
      if (query.length >= 5) {
        const translationId = useBibleStore.getState().activeTranslationId
        const epoch = operatorRevision()
        contextDebounceRef.current = setTimeout(() => {
          if (isOperatorWorkCurrent(epoch))
            runContextSearch(query, translationId).catch(console.error)
        }, 280)
      } else {
        contextSearchRequestIdRef.current += 1
        useBibleStore.getState().setSemanticResults([])
      }
    },
    [runContextSearch]
  )

  useEffect(() => {
    if (isOperatorMaintenanceActive()) return
    if (activeTab !== "context" || contextQuery.length < 5) return
    if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    const epoch = operatorRevision()
    contextDebounceRef.current = setTimeout(() => {
      if (isOperatorWorkCurrent(epoch))
        runContextSearch(contextQuery, activeTranslationId).catch(console.error)
    }, 120)
  }, [
    activeTranslationId,
    activeTab,
    contextQuery,
    runContextSearch,
    maintenancePhase,
  ])

  useEffect(() => {
    return () => {
      contextSearchRequestIdRef.current += 1
      if (contextDebounceRef.current) clearTimeout(contextDebounceRef.current)
    }
  }, [])

  // Derive autocomplete suggestion during render (no setState cascading)
  const autocompleteResult = useMemo(
    () => getAutocompleteSuggestion(quickInput, books),
    [quickInput, books]
  )
  const quickSuggestion = autocompleteResult.suggestion
  const quickSuggestionSuffix = getAutocompleteSuffix(
    quickInput,
    quickSuggestion
  )
  const hasQuickSuggestion = Boolean(
    quickSuggestion &&
    quickSuggestion !== quickInput &&
    quickSuggestionSuffix !== null
  )

  // Only an edit or explicit acceptance owns a typed navigation intent.
  // Catalog/translation refreshes may update suggestions but never replay it.
  useEffect(() => {
    if (
      quickComposing ||
      isOperatorMaintenanceActive() ||
      handledQuickEditRef.current === quickEditRevision
    )
      return
    handledQuickEditRef.current = quickEditRevision
    const state = useBibleStore.getState()
    if (
      state.translationSelectionStatus !== "ready" ||
      state.activeTranslationId !== quickOriginTranslationRef.current
    )
      return
    const result = getAutocompleteSuggestion(quickInput, state.books)
    if (result.matchedBook && result.chapter && result.verse) {
      state.setPendingNavigation({
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter,
        verse: result.verse,
      })
    }
  }, [quickInput, quickEditRevision, quickComposing])

  // Dropdown loading is read-only and has its own cancellable request.
  useEffect(() => {
    const epoch = operatorRevision()
    if (!isOperatorWorkCurrent(epoch) || quickComposing) return
    let cancelled = false
    const result = autocompleteResult

    if (
      (result.stage === "chapter" || result.stage === "verse") &&
      result.matchedBook &&
      result.chapter
    ) {
      invoke<Verse[]>("get_chapter", {
        translationId: activeTranslationId,
        bookNumber: result.matchedBook.book_number,
        chapter: result.chapter,
      })
        .then((verses) => {
          if (
            cancelled ||
            !isOperatorWorkCurrent(epoch) ||
            useBibleStore.getState().activeTranslationId !== activeTranslationId
          )
            return
          setQuickVersesList(verses)
          setQuickVerseRequest(`${activeTranslationId}|${quickInput}`)
          setShowQuickVerses(true)
        })
        .catch((error: unknown) => {
          if (!cancelled && isOperatorWorkCurrent(epoch)) console.error(error)
        })
    }
    return () => {
      cancelled = true
    }
  }, [
    autocompleteResult,
    activeTranslationId,
    maintenancePhase,
    quickInput,
    quickComposing,
  ])

  // Derive dropdown visibility: only show when autocomplete stage is chapter/verse
  const shouldShowVerseDropdown =
    showQuickVerses &&
    !quickComposing &&
    quickVerseRequest === `${activeTranslationId}|${quickInput}` &&
    (autocompleteResult.stage === "chapter" ||
      autocompleteResult.stage === "verse")

  const handleQuickKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.defaultPrevented || e.nativeEvent.isComposing || quickComposing)
        return
      // Tab or → accepts suggestion and advances to NEXT STAGE
      if (
        (e.key === "Tab" || e.key === "ArrowRight") &&
        quickSuggestion &&
        quickSuggestion !== quickInput
      ) {
        e.preventDefault()
        const nextInput = getTabNavigationResult(quickInput, quickSuggestion)
        editQuickInput(nextInput)
        return
      }

      // Enter commits the typed reference: send it live and clear the input
      if (e.key === "Enter") {
        e.preventDefault()
        const result = autocompleteResult
        if (result.matchedBook && result.chapter && result.verse) {
          useBibleStore.getState().setPendingNavigation({
            bookNumber: result.matchedBook.book_number,
            chapter: result.chapter,
            verse: result.verse,
            present: true,
          })
        }
        editQuickInput("")
        setShowQuickVerses(false)
        return
      }

      // First Escape clears completion; an empty input lets the app unfocus it.
      if (e.key === "Escape" && (quickInput || shouldShowVerseDropdown)) {
        e.preventDefault()
        editQuickInput("")
        setShowQuickVerses(false)
        return
      }
    },
    [
      quickInput,
      quickSuggestion,
      autocompleteResult,
      shouldShowVerseDropdown,
      editQuickInput,
      quickComposing,
    ]
  )

  const handleQuickVerseClick = useCallback(
    (verse: Verse) => {
      useBibleStore.getState().setPendingNavigation({
        bookNumber: verse.book_number,
        chapter: verse.chapter,
        verse: verse.verse,
        present: true,
      })
      editQuickInput("")
      setShowQuickVerses(false)
    },
    [editQuickInput]
  )

  return (
    <div
      ref={panelRef}
      data-slot="search-panel"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card outline-none"
      aria-label="Search panel"
      tabIndex={-1}
    >
      {/* STICKY: Tab row + search input */}
      <div className="flex min-h-11 shrink-0 items-center gap-0 border-b border-border">
        <div className="flex items-center gap-1 px-3 py-1.5">
          <button
            data-tour="book-search"
            onClick={() => setActiveTab("book")}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
              activeTab === "book"
                ? "border-lime-500/50 bg-lime-500/15"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <BookOpenIcon
              className={cn(
                "size-3.5",
                activeTab === "book" ? "text-lime-400" : "text-muted-foreground"
              )}
            />
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
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            <SparklesIcon
              className={cn(
                "size-3.5",
                activeTab === "context"
                  ? "text-lime-400"
                  : "text-muted-foreground"
              )}
            />
            Context search
          </button>
        </div>

        <label
          className="flex shrink-0 items-center gap-1.5 pr-3 text-xs text-muted-foreground"
          title="Follow detected verses in Bible browsing. Auto live is controlled separately."
        >
          Follow
          <Switch
            aria-label="Follow detections"
            data-tour="follow-detections"
            checked={followDetections}
            onCheckedChange={operatorActions.setFollowDetections}
          />
        </label>
        {activeTab === "book" ? (
          <div className="flex flex-1 items-center gap-2 pr-3">
            {/* EasyWorship-style autocomplete */}
            <div className="relative flex-1">
              {/* Suggestion overlay */}
              {hasQuickSuggestion && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center px-3">
                  <span className="text-xs font-normal">
                    <span className="text-foreground">{quickInput}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {quickSuggestionSuffix}
                    </span>
                  </span>
                </div>
              )}

              {/* Actual input */}
              <Input
                ref={quickInputRef}
                data-tour="quick-nav"
                aria-label="Bible reference search"
                value={quickInput}
                onChange={(event) => {
                  const input = event.target
                  const native = event.nativeEvent as InputEvent
                  const canComplete =
                    !quickComposing &&
                    !native.isComposing &&
                    !native.inputType?.startsWith("delete") &&
                    input.selectionStart === input.value.length &&
                    input.selectionEnd === input.value.length
                  editQuickInput(
                    canComplete
                      ? completeTypedReferenceInput(
                          input.value,
                          useBibleStore.getState().books
                        )
                      : input.value
                  )
                }}
                onCompositionStart={() => setQuickComposing(true)}
                onCompositionEnd={(event) => {
                  setQuickComposing(false)
                  editQuickInput(
                    completeTypedReferenceInput(
                      event.currentTarget.value,
                      useBibleStore.getState().books
                    )
                  )
                }}
                onKeyDown={handleQuickKeyDown}
                placeholder="Book chapter:verse"
                className={cn(
                  "relative h-7 bg-background text-xs",
                  hasQuickSuggestion ? "text-transparent" : ""
                )}
                style={
                  hasQuickSuggestion
                    ? {
                        caretColor: "var(--foreground)",
                      }
                    : undefined
                }
              />

              {/* Verse dropdown */}
              {shouldShowVerseDropdown && quickVersesList.length > 0 && (
                <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                  <div className="p-1">
                    {quickVersesList.map((verse) => (
                      <button
                        key={verse.id}
                        onClick={() => handleQuickVerseClick(verse)}
                        className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                      >
                        <span className="w-6 shrink-0 text-right font-semibold text-primary">
                          {verse.verse}
                        </span>
                        <span className="line-clamp-1 flex-1 text-muted-foreground">
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
                  await activateTranslation(id)
                } catch (err) {
                  console.error(err)
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-[72px] shrink-0 text-xs"
              >
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
                  await activateTranslation(id)
                } catch (err) {
                  console.error(err)
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-[72px] shrink-0 text-xs"
              >
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

          <div className="flex min-h-9 shrink-0 items-center justify-between border-b border-border px-3 py-2">
            {selectedBook ? (
              <h3 className="text-sm font-semibold text-foreground">
                {selectedBook.name} {chapter}
              </h3>
            ) : null}
            {selectedBook ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    if (chapter > 1) {
                      setChapter((c) => c - 1)
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
                  }}
                >
                  <ArrowRightIcon className="size-3" />
                </Button>
              </div>
            ) : null}
          </div>

          {/* SCROLLABLE: Verse list only */}
          <div
            data-operator-list="bible"
            tabIndex={0}
            aria-label="Bible verses"
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div className="flex flex-col gap-0 p-2">
              {currentChapter.map((verse) => (
                <div
                  key={verse.id}
                  id={`verse-${verse.id}`}
                  data-operator-item={`verse-${verse.id}`}
                  data-operator-present
                  tabIndex={0}
                  aria-label={`${verse.book_name} ${verse.chapter}:${verse.verse}`}
                  onClick={() => handleVerseClick(verse)}
                  className={cn(
                    "group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
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
                  {queuedVerseKeys.has(
                    `${verse.book_number}:${verse.chapter}:${verse.verse}`
                  ) ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className="flex size-6 shrink-0 cursor-pointer items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation()
                              const store = useQueueStore.getState()
                              const idx = store.findDuplicate(
                                verse.book_number,
                                verse.chapter,
                                verse.verse
                              )
                              if (idx !== -1) {
                                store.flashItem(store.items[idx].id)
                                document
                                  .querySelector(
                                    `[data-slot="queue-panel"] [data-queue-idx="${idx}"]`
                                  )
                                  ?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "nearest",
                                  })
                              }
                            }}
                          >
                            <CheckIcon className="size-4 text-ai-direct" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Already in queue
                        </TooltipContent>
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
                              "shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
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
                        <TooltipContent side="left">
                          Add to queue
                        </TooltipContent>
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
        <div
          data-operator-list="context"
          tabIndex={0}
          aria-label="Context search results"
          className="min-h-0 flex-1 overflow-y-auto"
        >
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
                data-operator-item={`context-${result.book_number}:${result.chapter}:${result.verse}`}
                data-operator-present
                tabIndex={0}
                aria-label={result.verse_ref}
                onClick={() => {
                  const verse: Verse = {
                    id: 0,
                    translation_id: activeTranslationId,
                    book_number: result.book_number,
                    book_name: result.book_name,
                    book_abbreviation: "",
                    chapter: result.chapter,
                    verse: result.verse,
                    text: result.verse_text,
                  }
                  bibleActions.selectVerse(verse)
                  void presentVerse(verse)
                }}
                className="group relative flex cursor-pointer flex-col gap-1 rounded-lg p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex shrink-0 flex-row items-start gap-2">
                  <span className="text-xs font-semibold">
                    {result.book_name} {result.chapter}:{result.verse}
                  </span>
                  <ResultSourceBadges result={result} />
                </div>
                <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                  <HighlightedText
                    text={result.verse_text}
                    query={contextQuery}
                  />
                </p>
                {queuedVerseKeys.has(
                  `${result.book_number}:${result.chapter}:${result.verse}`
                ) ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="absolute top-1/2 right-2 flex size-6 shrink-0 -translate-y-1/2 cursor-pointer items-center justify-center"
                          onClick={(e) => {
                            e.stopPropagation()
                            const store = useQueueStore.getState()
                            const idx = store.findDuplicate(
                              result.book_number,
                              result.chapter,
                              result.verse
                            )
                            if (idx !== -1) {
                              store.flashItem(store.items[idx].id)
                              document
                                .querySelector(
                                  `[data-slot="queue-panel"] [data-queue-idx="${idx}"]`
                                )
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                })
                            }
                          }}
                        >
                          <CheckIcon className="size-4 text-ai-direct" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        Already in queue
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1/2 right-2 shrink-0 -translate-y-1/2 bg-primary text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary/80"
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
