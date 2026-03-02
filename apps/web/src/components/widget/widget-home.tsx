'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUpIcon, MagnifyingGlassIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import { LightBulbIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetPost {
  id: string
  title: string
  voteCount: number
  statusId: string | null
  commentCount: number
  board?: { id: string; name: string; slug: string }
}

interface StatusInfo {
  id: string
  name: string
  color: string
}

interface BoardInfo {
  id: string
  name: string
  slug: string
}

interface WidgetHomeProps {
  initialPosts: WidgetPost[]
  statuses: StatusInfo[]
  boards: BoardInfo[]
  defaultBoard?: string
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  selectedBoardSlug: string | undefined
  onBoardChange: (slug: string | undefined) => void
  onSubmitNew: (title: string) => void
}

interface SearchResult {
  posts: WidgetPost[]
}

const searchCache = new Map<string, SearchResult>()

export function WidgetHome({
  initialPosts,
  statuses,
  boards,
  searchQuery,
  onSearchQueryChange,
  selectedBoardSlug,
  onBoardChange,
  onSubmitNew,
}: WidgetHomeProps) {
  const { isIdentified, widgetFetch } = useWidgetAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  // Search state
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Vote state
  const [votedPostIds, setVotedPostIds] = useState<Set<string>>(new Set())
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set())
  const [voteCountOverrides, setVoteCountOverrides] = useState<Map<string, number>>(new Map())
  const [authPromptPostId, setAuthPromptPostId] = useState<string | null>(null)

  // Board dropdown state
  const [boardOpen, setBoardOpen] = useState(false)

  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

  // Auto-focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  // Fetch voted post IDs
  useEffect(() => {
    if (!isIdentified) {
      setVotedPostIds(new Set())
      return
    }

    let cancelled = false
    widgetFetch('/api/widget/voted-posts')
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.data?.votedPostIds) {
          setVotedPostIds(new Set(json.data.votedPostIds))
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [isIdentified, widgetFetch])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const q = searchQuery.trim()
    if (!q) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }

    const cacheKey = `${q}|${selectedBoardSlug ?? ''}`
    const cached = searchCache.get(cacheKey)
    if (cached) {
      setSearchResults(cached)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '5' })
        if (selectedBoardSlug) params.set('board', selectedBoardSlug)
        const res = await fetch(`/api/widget/search?${params}`)
        const json = await res.json()
        const result: SearchResult = { posts: json.data?.posts ?? [] }
        searchCache.set(cacheKey, result)
        setSearchResults(result)
      } catch {
        setSearchResults({ posts: [] })
      } finally {
        setIsSearching(false)
      }
    }, 250)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchQuery, selectedBoardSlug])

  const handleVote = useCallback(
    async (postId: string) => {
      if (!isIdentified) {
        setAuthPromptPostId(postId)
        setTimeout(() => setAuthPromptPostId(null), 3000)
        return
      }
      if (pendingVotes.has(postId)) return

      const wasVoted = votedPostIds.has(postId)
      const delta = wasVoted ? -1 : 1

      // Optimistic update
      setPendingVotes((prev) => new Set(prev).add(postId))
      setVotedPostIds((prev) => {
        const next = new Set(prev)
        if (wasVoted) next.delete(postId)
        else next.add(postId)
        return next
      })
      setVoteCountOverrides((prev) => {
        const next = new Map(prev)
        const current = next.get(postId) ?? getPostVoteCount(postId)
        next.set(postId, current + delta)
        return next
      })

      try {
        const res = await widgetFetch('/api/widget/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId }),
        })
        if (!res.ok) throw new Error(`Vote failed: ${res.status}`)
        const json = await res.json()
        if (json.data) {
          setVoteCountOverrides((prev) => {
            const next = new Map(prev)
            next.set(postId, json.data.voteCount)
            return next
          })
          setVotedPostIds((prev) => {
            const next = new Set(prev)
            if (json.data.voted) next.add(postId)
            else next.delete(postId)
            return next
          })
        }
      } catch {
        // Revert
        setVotedPostIds((prev) => {
          const next = new Set(prev)
          if (wasVoted) next.add(postId)
          else next.delete(postId)
          return next
        })
        setVoteCountOverrides((prev) => {
          const next = new Map(prev)
          const current = next.get(postId) ?? getPostVoteCount(postId)
          next.set(postId, current - delta)
          return next
        })
      } finally {
        setPendingVotes((prev) => {
          const next = new Set(prev)
          next.delete(postId)
          return next
        })
      }
    },
    [isIdentified, widgetFetch, votedPostIds, pendingVotes]
  )

  function getPostVoteCount(postId: string): number {
    if (voteCountOverrides.has(postId)) return voteCountOverrides.get(postId)!
    const fromInitial = initialPosts.find((p) => p.id === postId)
    if (fromInitial) return fromInitial.voteCount
    const fromSearch = searchResults?.posts.find((p) => p.id === postId)
    return fromSearch?.voteCount ?? 0
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (searchQuery) {
        // Clear search first — stop propagation so the shell's global
        // Escape handler doesn't also close the widget
        e.nativeEvent.stopImmediatePropagation()
        onSearchQueryChange('')
      }
      // If no search query, let it bubble to the shell's global handler
      // which will close the widget
    }
    if (e.key === 'Enter' && searchQuery.trim()) {
      const hasResults = searchResults && searchResults.posts.length > 0
      if (!hasResults) {
        onSubmitNew(searchQuery.trim())
      }
    }
  }

  const isSearchMode = searchQuery.trim().length > 0
  const filteredInitialPosts = selectedBoardSlug
    ? initialPosts.filter((p) => p.board?.slug === selectedBoardSlug)
    : initialPosts
  const displayPosts = isSearchMode ? (searchResults?.posts ?? []) : filteredInitialPosts
  const sectionLabel = isSearchMode
    ? isSearching
      ? 'Searching...'
      : displayPosts.length > 0
        ? 'Matching ideas'
        : null
    : 'Popular ideas'

  const truncatedQuery =
    searchQuery.trim().length > 30 ? searchQuery.trim().slice(0, 30) + '...' : searchQuery.trim()

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-3 pt-3 pb-1 shrink-0">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What's on your mind?"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary focus:bg-background transition-colors"
          />
        </div>

        {/* Board selector */}
        {boards.length > 1 && (
          <div className="relative mt-1.5">
            <button
              type="button"
              onClick={() => setBoardOpen(!boardOpen)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted/50"
            >
              <span className="text-muted-foreground/60">in</span>
              <span className="font-medium">
                {selectedBoardSlug
                  ? (boards.find((b) => b.slug === selectedBoardSlug)?.name ?? 'All boards')
                  : 'All boards'}
              </span>
              <svg
                className="w-3 h-3"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 5l3 3 3-3" />
              </svg>
            </button>
            {boardOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBoardOpen(false)} />
                <div className="absolute left-0 top-full mt-0.5 z-20 bg-background border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                  <button
                    type="button"
                    onClick={() => {
                      onBoardChange(undefined)
                      setBoardOpen(false)
                    }}
                    className={cn(
                      'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors',
                      !selectedBoardSlug && 'font-medium text-primary'
                    )}
                  >
                    All boards
                  </button>
                  {boards.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        onBoardChange(b.slug)
                        setBoardOpen(false)
                      }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors',
                        selectedBoardSlug === b.slug && 'font-medium text-primary'
                      )}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Post list */}
      <ScrollArea className="flex-1 min-h-0 px-3 pb-2">
        {sectionLabel && (
          <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide px-1 py-1.5">
            {sectionLabel}
          </p>
        )}

        {!isSearchMode && displayPosts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <LightBulbIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm font-medium text-muted-foreground/70">No ideas yet</p>
            <p className="text-xs text-muted-foreground/50 mt-0.5">Be the first to share one!</p>
          </div>
        )}

        {displayPosts.length > 0 && (
          <div className="space-y-1">
            {displayPosts.map((post) => {
              const status = post.statusId ? (statusMap.get(post.statusId) ?? null) : null
              const voteCount = voteCountOverrides.get(post.id) ?? post.voteCount
              const hasVoted = votedPostIds.has(post.id)
              const isPending = pendingVotes.has(post.id)

              return (
                <div key={post.id}>
                  <div className="flex items-center gap-2 rounded-lg hover:bg-muted/30 transition-colors px-2 py-1.5">
                    {/* Vote button */}
                    <button
                      type="button"
                      onClick={() => handleVote(post.id)}
                      disabled={isPending}
                      aria-label={hasVoted ? `Remove vote (${voteCount})` : `Vote (${voteCount})`}
                      aria-pressed={hasVoted}
                      className={cn(
                        'flex flex-col items-center justify-center shrink-0 w-10 h-10 rounded-md border transition-all duration-200',
                        hasVoted
                          ? 'text-primary bg-primary/10 border-primary/30'
                          : 'text-muted-foreground bg-muted/30 border-border/50 hover:bg-muted/50 hover:border-border',
                        isPending && 'opacity-70 cursor-wait'
                      )}
                    >
                      <ChevronUpIcon className={cn('h-3.5 w-3.5', hasVoted && 'text-primary')} />
                      <span
                        className={cn(
                          'text-xs font-semibold tabular-nums leading-none',
                          hasVoted ? 'text-primary' : 'text-foreground'
                        )}
                      >
                        {voteCount}
                      </span>
                    </button>

                    {/* Post info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground line-clamp-1">
                        {post.title}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {status && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <span
                              className="size-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: status.color }}
                            />
                            {status.name}
                          </span>
                        )}
                        {post.board && !selectedBoardSlug && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                            <Squares2X2Icon className="h-2.5 w-2.5 text-muted-foreground/40" />
                            {post.board.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {authPromptPostId === post.id && (
                    <p className="text-[11px] text-muted-foreground ml-14 -mt-0.5 mb-1 animate-in fade-in">
                      Sign in to your app to vote
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Search mode: no results */}
        {isSearchMode && !isSearching && searchResults && searchResults.posts.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-4 text-center mt-2">
            <p className="text-sm text-muted-foreground">No matching ideas found</p>
            <button
              type="button"
              onClick={() => onSubmitNew(searchQuery.trim())}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Submit &ldquo;{truncatedQuery}&rdquo; as new idea
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        )}

        {/* Search mode: has results — show submit CTA below */}
        {isSearchMode && !isSearching && searchResults && searchResults.posts.length > 0 && (
          <div className="border-t border-border/50 mt-2 pt-2 px-1">
            <p className="text-xs text-muted-foreground/60">Don&apos;t see your idea?</p>
            <button
              type="button"
              onClick={() => onSubmitNew(searchQuery.trim())}
              className="mt-0.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Submit &ldquo;{truncatedQuery}&rdquo; as new idea &rarr;
            </button>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
