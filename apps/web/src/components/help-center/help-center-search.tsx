import { useState, useRef, useCallback, useEffect } from 'react'
import { useIntl } from 'react-intl'
import { MagnifyingGlassIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { contentPreview } from '@/lib/shared/utils/string'
import {
  AskAiAnswerPanel,
  AskAiRow,
  HighlightedText,
  useAskAiAvailable,
  useAskAiSearchController,
  type AskAiSourceMeta,
} from '@/components/help-center/ask-ai'
import { useKbSearch, type KbSearchArticle } from '@/components/help-center/use-kb-search'
import { localizedHcPath } from '@/lib/shared/help-center-url'

// ============================================================================
// Hero Search (landing page)
// ============================================================================

interface HelpCenterHeroSearchProps {
  /** Surface hook: the route decides whether Ask AI may be offered. */
  askAiEnabled?: boolean
  /** Content locale (domains/languages §2). Omitted = default locale. The
   *  widget passes its own UI locale here; portal /hc routes pass the
   *  route's locale param. */
  locale?: string
}

export function HelpCenterHeroSearch({ askAiEnabled = false, locale }: HelpCenterHeroSearchProps) {
  const intl = useIntl()
  const [query, setQuery] = useState('')
  const [showResults, setShowResults] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const askAiAvailable = useAskAiAvailable(askAiEnabled)
  const { results, isSearching } = useKbSearch({
    query,
    limit: 8,
    locale,
    // With Ask AI available the dropdown also opens on zero results: the
    // pinned Ask-AI row is the no-results affordance.
    onResults: (articles) => setShowResults(articles.length > 0 || askAiAvailable),
  })

  // A cleared query always closes the dropdown (the hook only reports
  // results for non-blank queries).
  useEffect(() => {
    if (!query.trim()) setShowResults(false)
  }, [query])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleResultClick = (result: KbSearchArticle) => {
    setShowResults(false)
    setQuery('')
    const path = `/hc/articles/${result.category.slug}/${result.slug}`
    window.location.href = locale ? localizedHcPath(locale, path) : path
  }

  const handleSourceClick = useCallback(
    (source: AskAiSourceMeta) => {
      const path = `/hc/articles/${source.categorySlug}/${source.slug}`
      window.location.href = locale ? localizedHcPath(locale, path) : path
    },
    [locale]
  )

  const {
    askAiState,
    selectedIndex,
    hasAskRow,
    answerOpen,
    askRowOffset,
    triggerAsk,
    dismissAnswer,
    handleKeyDown,
  } = useAskAiSearchController({
    query,
    askAiAvailable,
    resultCount: results.length,
    onSelectResult: (idx) => {
      const result = results[idx]
      if (result) handleResultClick(result)
    },
    onClearQuery: () => {
      setQuery('')
      setShowResults(false)
    },
    onAsk: () => setShowResults(false),
    // Return to the autocomplete results for the current query.
    onDismiss: () => {
      if (query.trim()) setShowResults(results.length > 0 || askAiAvailable)
    },
  })

  const placeholderText = askAiAvailable
    ? intl.formatMessage({
        id: 'helpAskAi.searchPlaceholder',
        defaultMessage: 'Ask AI or search our help articles to find an answer',
      })
    : 'Search articles...'

  return (
    <div ref={containerRef} role="search" className="relative w-full">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted pl-5 pr-2 shadow-lg transition-[color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/20">
        <MagnifyingGlassIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          id="hc-search"
          type="search"
          aria-label={placeholderText}
          placeholder={placeholderText}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => (results.length > 0 || (hasAskRow && !answerOpen)) && setShowResults(true)}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
        {isSearching && (
          <div className="shrink-0 pr-1">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}
        {hasAskRow && (
          <button
            type="button"
            onClick={triggerAsk}
            aria-label={intl.formatMessage({
              id: 'helpAskAi.rowSubtitle',
              defaultMessage: 'Use AI to answer your question in seconds',
            })}
            className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ArrowRightIcon className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}
      </div>

      {!answerOpen && showResults && (results.length > 0 || hasAskRow) && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-popover shadow-lg z-50 overflow-hidden">
          {hasAskRow && (
            <div className={`p-1.5 ${results.length > 0 ? 'border-b border-border/60' : ''}`}>
              <AskAiRow query={query} onSelect={triggerAsk} highlighted={selectedIndex === 0} />
            </div>
          )}
          {results.length > 0 && (
            <ul className="py-1">
              {results.map((result, idx) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => handleResultClick(result)}
                    data-highlighted={selectedIndex === idx + askRowOffset || undefined}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedIndex === idx + askRowOffset ? 'bg-accent' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="text-sm font-medium text-foreground">
                      <HighlightedText text={result.title} query={query} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {result.category.name}
                    </div>
                    {result.content && (
                      <div className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                        <HighlightedText text={contentPreview(result.content, 150)} query={query} />
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {answerOpen && (
        <div className="mt-3 text-start">
          <AskAiAnswerPanel
            state={askAiState}
            onDismiss={dismissAnswer}
            onSourceClick={handleSourceClick}
          />
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Compact Search (header button placeholder)
// ============================================================================

export function HelpCenterCompactSearch() {
  return (
    <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" disabled>
      <MagnifyingGlassIcon className="h-4 w-4" />
      <span className="hidden sm:inline">Search...</span>
    </Button>
  )
}
