import { useState, useRef, useCallback, useEffect } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { truncateContent } from './help-center-utils'

// ============================================================================
// Types
// ============================================================================

interface SearchResult {
  id: string
  slug: string
  title: string
  content: string
  category: {
    id: string
    slug: string
    name: string
  }
}

// ============================================================================
// Hero Search (landing page)
// ============================================================================

export function HelpCenterHeroSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setShowResults(false)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    try {
      const res = await fetch(`/api/widget/kb-search?q=${encodeURIComponent(q)}&limit=8`)
      const json = await res.json()
      const articles: SearchResult[] = json.data?.articles ?? []
      setResults(articles)
      setShowResults(articles.length > 0)
    } catch {
      setResults([])
      setShowResults(false)
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setQuery(value)

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        doSearch(value)
      }, 300)
    },
    [doSearch]
  )

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

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleResultClick = (result: SearchResult) => {
    setShowResults(false)
    setQuery('')
    window.location.href = `/hc/${result.category.slug}/${result.slug}`
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xl mx-auto">
      <div className="relative">
        <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search articles..."
          value={query}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setShowResults(true)}
          className="h-12 pl-12 pr-4 text-base rounded-xl shadow-sm border-border/60 bg-background"
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-border bg-popover shadow-lg z-50 overflow-hidden">
          <ul className="py-1">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => handleResultClick(result)}
                  className="w-full text-left px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div className="text-sm font-medium text-foreground">{result.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{result.category.name}</div>
                  {result.content && (
                    <div className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">
                      {truncateContent(result.content)}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
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
