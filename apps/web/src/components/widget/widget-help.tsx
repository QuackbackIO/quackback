import { useState, useEffect, useRef, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MagnifyingGlassIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

interface WidgetHelpArticle {
  id: string
  slug: string
  title: string
  content: string
  category: { id: string; slug: string; name: string }
}

interface WidgetHelpProps {
  onArticleSelect?: (articleId: string) => void
}

export function WidgetHelp({ onArticleSelect }: WidgetHelpProps) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<WidgetHelpArticle[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef(new Map<string, WidgetHelpArticle[]>())

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([])
      return
    }

    const cached = cacheRef.current.get(query)
    if (cached) {
      setResults(cached)
      return
    }

    // Cap cache size to prevent unbounded growth
    if (cacheRef.current.size >= 30) {
      const firstKey = cacheRef.current.keys().next().value!
      cacheRef.current.delete(firstKey)
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsSearching(true)
    try {
      const res = await fetch(`/api/widget/kb-search?q=${encodeURIComponent(query)}&limit=10`, {
        signal: controller.signal,
      })
      const data = await res.json()
      const articles = data.data?.articles ?? []
      cacheRef.current.set(query, articles)
      setResults(articles)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => doSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search, doSearch])

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search help articles..."
            className="w-full pl-8 pr-3 py-2 text-sm bg-muted/30 border border-border/50 rounded-lg placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 h-full">
        <div className="px-3 pt-1 pb-3">
          {isSearching && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-muted-foreground/50">Searching...</span>
            </div>
          )}

          {!isSearching && search && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <QuestionMarkCircleIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium text-muted-foreground/70">No results found</p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                Try different keywords or browse categories.
              </p>
            </div>
          )}

          {!isSearching && !search && (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <QuestionMarkCircleIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium text-muted-foreground/70">Search for help</p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                Type a question or keyword above to find help articles.
              </p>
            </div>
          )}

          {!isSearching && results.length > 0 && (
            <div className="space-y-1">
              {results.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onArticleSelect?.(article.slug)}
                  className="w-full text-left rounded-lg hover:bg-muted/30 transition-colors px-2.5 py-2.5 cursor-pointer"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                      {article.category.name}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                    {article.title}
                  </h3>
                  <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                    {article.content}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
