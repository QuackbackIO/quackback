/**
 * Debounced help-center article search against /api/widget/help-center-search, with a
 * small per-mount result cache and in-flight abort. Shared by the widget
 * Help tab and the /hc hero search.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface HelpCenterSearchArticle {
  id: string
  urlId: number
  slug: string
  title: string
  content: string
  category: { id: string; slug: string; name: string }
}

const DEBOUNCE_MS = 300
const CACHE_SIZE = 30

export function useHelpCenterSearch({
  query,
  limit,
  locale,
  sessionVersion,
  getHeaders,
  onResults,
}: {
  query: string
  limit: number
  /** Omitted = default locale. The widget passes its own UI locale through
   *  (domains/languages §2); an unrecognized/not-enabled locale falls back
   *  to default server-side. */
  locale?: string
  /** Widget session — included in the cache key and clears hits on change. */
  sessionVersion?: number
  /** Widget Bearer (or empty on the portal, which uses cookies). */
  getHeaders?: () => HeadersInit
  /** Fired with the articles of each completed search (cache hits included);
   *  not fired when the query is blank. */
  onResults?: (articles: HelpCenterSearchArticle[]) => void
}): { results: HelpCenterSearchArticle[]; isSearching: boolean } {
  const [results, setResults] = useState<HelpCenterSearchArticle[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const cacheRef = useRef(new Map<string, HelpCenterSearchArticle[]>())
  // Latest callback without retriggering the debounce effect.
  const onResultsRef = useRef(onResults)
  onResultsRef.current = onResults
  const getHeadersRef = useRef(getHeaders)
  getHeadersRef.current = getHeaders
  const sessionVersionRef = useRef(sessionVersion)
  sessionVersionRef.current = sessionVersion

  const doSearch = useCallback(
    async (q: string, loc: string | undefined, version: number | undefined) => {
      if (!q.trim()) {
        setResults([])
        return
      }

      const cacheKey = `${version ?? ''}:${loc ?? ''}:${q}`
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        setResults(cached)
        onResultsRef.current?.(cached)
        return
      }

      if (cacheRef.current.size >= CACHE_SIZE) {
        const firstKey = cacheRef.current.keys().next().value!
        cacheRef.current.delete(firstKey)
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setIsSearching(true)
      try {
        const params = new URLSearchParams({ q, limit: String(limit) })
        if (loc) params.set('locale', loc)
        const res = await fetch(`/api/widget/help-center-search?${params.toString()}`, {
          signal: controller.signal,
          headers: getHeadersRef.current?.(),
        })
        if (!res.ok) return
        if (version !== sessionVersionRef.current) return
        const data = await res.json()
        const articles: HelpCenterSearchArticle[] = data.data?.articles ?? []
        cacheRef.current.set(cacheKey, articles)
        setResults(articles)
        onResultsRef.current?.(articles)
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      } finally {
        setIsSearching(false)
      }
    },
    [limit]
  )

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    cacheRef.current.clear()
    setResults([])
    setIsSearching(false)
  }, [sessionVersion])

  useEffect(() => {
    const timer = setTimeout(() => void doSearch(query, locale, sessionVersion), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, locale, sessionVersion, doSearch])

  return { results, isSearching }
}
