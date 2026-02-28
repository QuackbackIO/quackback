import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { SearchIcon, XIcon, Loader2Icon } from 'lucide-react'
import { useAppContext } from './use-app-context'
import { SidebarPostRow, type PostRowData } from './sidebar-post-row'

interface SidebarSearchProps {
  linkedPostIds: Set<string>
  onLink: (postId: string) => Promise<void>
  onSearchActiveChange: (active: boolean) => void
  onCreateFromSearch?: (query: string) => void
}

export function SidebarSearch({
  linkedPostIds,
  onLink,
  onSearchActiveChange,
  onCreateFromSearch,
}: SidebarSearchProps) {
  const { appFetch } = useAppContext()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PostRowData[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const isActive = query.length > 0

  useEffect(() => {
    onSearchActiveChange(isActive)
  }, [isActive, onSearchActiveChange])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }

    if (debounceRef.current !== undefined) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await appFetch(`/api/v1/apps/search?q=${encodeURIComponent(query)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          setResults(data.data?.posts ?? [])
        }
      } catch {
        // Silently fail search
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current !== undefined) clearTimeout(debounceRef.current)
    }
  }, [query, appFetch])

  function clearSearch() {
    setQuery('')
    setResults([])
  }

  return (
    <div>
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search posts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 pl-8 pr-8 text-sm"
        />
        {isActive && (
          <button
            onClick={clearSearch}
            className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {isActive && (
        <div className="mt-3">
          {loading ? (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
              Searching...
            </div>
          ) : results.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Results
              </h3>
              <div className="space-y-2">
                {results.map((post) => {
                  const isLinked = linkedPostIds.has(post.id)
                  return (
                    <SidebarPostRow
                      key={post.id}
                      post={post}
                      linked={isLinked}
                      onLink={isLinked ? undefined : () => onLink(post.id)}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No posts found for "{query}"
            </p>
          )}

          {onCreateFromSearch && query.trim() && (
            <button
              onClick={() => onCreateFromSearch(query.trim())}
              className="mt-3 flex w-full items-center justify-center rounded-lg border border-dashed p-3 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            >
              + Create "{query.trim()}" as new post
            </button>
          )}
        </div>
      )}
    </div>
  )
}
