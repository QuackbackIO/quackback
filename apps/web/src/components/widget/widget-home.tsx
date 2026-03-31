import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Squares2X2Icon, PencilIcon } from '@heroicons/react/24/solid'
import {
  LightBulbIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { listPublicPostsFn } from '@/lib/server/functions/public-posts'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { WidgetVoteButton } from './widget-vote-button'
import { useWidgetAuth } from './widget-auth-provider'
import type { PostId } from '@quackback/ids'

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
  initialHasMore?: boolean
  statuses: StatusInfo[]
  boards: BoardInfo[]
  onPostSelect?: (postId: string) => void
  onPostCreated?: (post: {
    id: string
    title: string
    voteCount: number
    statusId: string | null
    board: { id: string; name: string; slug: string }
  }) => void
  anonymousVotingEnabled?: boolean
  anonymousPostingEnabled?: boolean
}

interface SearchResult {
  posts: WidgetPost[]
}

const similarSearchCache = new Map<string, SearchResult>()

const identityInputCls =
  'bg-background rounded-md border border-border/50 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/50 transition-colors'

// ── Shared post row used in both similar-posts and popular-ideas lists ──

function WidgetPostRow({
  post,
  statusMap,
  showBoard,
  compact,
  canVote,
  ensureSessionThen,
  onAuthRequired,
  onSelect,
}: {
  post: WidgetPost
  statusMap: Map<string, StatusInfo>
  showBoard?: boolean
  compact?: boolean
  canVote: boolean
  ensureSessionThen: (callback: () => void | Promise<void>) => Promise<void>
  onAuthRequired?: () => void
  onSelect?: () => void
}) {
  const status = post.statusId ? (statusMap.get(post.statusId) ?? null) : null
  return (
    <div
      className={`w-full overflow-hidden flex items-center gap-2 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}
      onClick={onSelect}
    >
      <div onClick={(e) => e.stopPropagation()} className="shrink-0">
        <WidgetVoteButton
          postId={post.id as PostId}
          voteCount={post.voteCount}
          compact={compact}
          onBeforeVote={
            canVote
              ? async () => {
                  let success = false
                  await ensureSessionThen(() => {
                    success = true
                  })
                  return success
                }
              : undefined
          }
          onAuthRequired={!canVote ? onAuthRequired : undefined}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {status && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <span
                className="size-1.5 rounded-full shrink-0"
                style={{ backgroundColor: status.color }}
              />
              {status.name}
            </span>
          )}
          {showBoard && post.board && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
              <Squares2X2Icon className="h-2.5 w-2.5 text-muted-foreground/40" />
              {post.board.name}
            </span>
          )}
        </div>
        <p
          className={`font-medium text-foreground line-clamp-1 ${compact ? 'text-xs' : 'text-sm'}`}
        >
          {post.title}
        </p>
      </div>
    </div>
  )
}

function usePillsScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setCanScrollLeft((prev) => (prev === left ? prev : left))
    setCanScrollRight((prev) => (prev === right ? prev : right))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [update])

  const scrollBy = useCallback((delta: number) => {
    ref.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }, [])

  return { ref, canScrollLeft, canScrollRight, scrollBy }
}

// ── Main component ──

export function WidgetHome({
  initialPosts,
  initialHasMore = false,
  statuses,
  boards,
  onPostSelect,
  onPostCreated,
  anonymousVotingEnabled = true,
  anonymousPostingEnabled = false,
}: WidgetHomeProps) {
  const {
    ensureSession,
    ensureSessionThen,
    isIdentified,
    hmacRequired,
    user,
    emitEvent,
    metadata,
    identifyWithEmail,
  } = useWidgetAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const canVote = isIdentified || anonymousVotingEnabled
  const canPost = isIdentified || anonymousPostingEnabled
  const needsEmail = !isIdentified && !hmacRequired && !anonymousPostingEnabled

  const [title, setTitle] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [selectedBoardId, setSelectedBoardId] = useState(boards[0]?.id ?? '')
  const [content, setContent] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [similarPostResults, setSimilarPostResults] = useState<SearchResult | null>(null)
  const [isSimilarSearching, setIsSimilarSearching] = useState(false)
  const similarDebounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [activeBoardSlug, setActiveBoardSlug] = useState<string | null>(null)
  const pills = usePillsScroll()
  const [popularSearch, setPopularSearch] = useState('')
  const [debouncedPopularSearch, setDebouncedPopularSearch] = useState('')
  const popularSearchDebounceRef = useRef<ReturnType<typeof setTimeout>>(null)
  const [popularSearchOpen, setPopularSearchOpen] = useState(false)
  const popularSearchInputRef = useRef<HTMLInputElement>(null)

  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])

  // Infinite query for popular ideas — page 1 seeded from SSR, pages 2+ fetched on scroll
  const {
    data: postsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingPosts,
  } = useInfiniteQuery({
    queryKey: ['widget', 'posts', 'popular', 'top', activeBoardSlug ?? 'all'],
    queryFn: ({ pageParam }) =>
      listPublicPostsFn({
        data: {
          sort: 'top',
          page: pageParam,
          limit: 20,
          boardSlug: activeBoardSlug ?? undefined,
        },
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    // Only seed from SSR data on the initial unfiltered view
    initialData:
      activeBoardSlug === null
        ? {
            pages: [{ items: initialPosts, total: -1, hasMore: initialHasMore }],
            pageParams: [1],
          }
        : undefined,
  })

  const allPopularPosts: WidgetPost[] = useMemo(
    () =>
      postsData?.pages.flatMap((page) =>
        page.items.map(
          (p): WidgetPost => ({
            id: p.id,
            title: p.title,
            voteCount: p.voteCount,
            statusId: p.statusId ?? null,
            commentCount: (p as WidgetPost).commentCount ?? 0,
            board: (p as WidgetPost).board,
          })
        )
      ) ?? [],
    [postsData]
  )

  const postsSentinelRef = useInfiniteScroll({
    hasMore: hasNextPage ?? false,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  // Search query for popular ideas — replaces infinite list when active
  const { data: popularSearchData, isFetching: isPopularSearchFetching } = useQuery({
    queryKey: ['widget', 'search', 'popular', debouncedPopularSearch, activeBoardSlug ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ q: debouncedPopularSearch, limit: '20' })
      if (activeBoardSlug) params.set('board', activeBoardSlug)
      const res = await fetch(`/api/widget/search?${params}`)
      const json = await res.json()
      return { posts: (json.data?.posts ?? []) as WidgetPost[] }
    },
    enabled: debouncedPopularSearch.length > 0,
  })

  const handleAuthRequired = useCallback(
    (postId: string) => {
      if (!hmacRequired && onPostSelect) {
        onPostSelect(postId)
      } else {
        window.parent.postMessage(
          { type: 'quackback:navigate', url: `${window.location.origin}/auth/login` },
          '*'
        )
      }
    },
    [hmacRequired, onPostSelect]
  )

  useEffect(() => {
    if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current)
    const q = title.trim()
    if (!q) {
      setSimilarPostResults(null)
      setIsSimilarSearching(false)
      return
    }
    const cached = similarSearchCache.get(q)
    if (cached) {
      setSimilarPostResults(cached)
      setIsSimilarSearching(false)
      return
    }
    setIsSimilarSearching(true)
    const controller = new AbortController()
    similarDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '5' })
        const res = await fetch(`/api/widget/search?${params}`, { signal: controller.signal })
        const json = await res.json()
        const result: SearchResult = { posts: json.data?.posts ?? [] }
        similarSearchCache.set(q, result)
        setSimilarPostResults(result)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setSimilarPostResults({ posts: [] })
      } finally {
        setIsSimilarSearching(false)
      }
    }, 300)
    return () => {
      if (similarDebounceRef.current) clearTimeout(similarDebounceRef.current)
      controller.abort()
    }
  }, [title])

  // Debounce popular ideas search
  useEffect(() => {
    if (popularSearchDebounceRef.current) clearTimeout(popularSearchDebounceRef.current)
    popularSearchDebounceRef.current = setTimeout(() => {
      setDebouncedPopularSearch(popularSearch)
    }, 300)
    return () => {
      if (popularSearchDebounceRef.current) clearTimeout(popularSearchDebounceRef.current)
    }
  }, [popularSearch])

  useEffect(() => {
    if (popularSearchOpen) {
      popularSearchInputRef.current?.focus()
    } else {
      setPopularSearch('')
    }
  }, [popularSearchOpen])

  function collapseForm() {
    setExpanded(false)
    setTitle('')
    setContent('')
    setEmail('')
    setName('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !selectedBoardId || isSubmitting) return
    if (needsEmail && !email.trim()) return

    setIsSubmitting(true)
    setError(null)

    try {
      if (needsEmail) {
        const identified = await identifyWithEmail(email.trim(), name.trim() || undefined)
        if (!identified) {
          setError('Could not verify your email. Please try again.')
          setIsSubmitting(false)
          return
        }
      } else if (!canPost) {
        if (hmacRequired) {
          window.parent.postMessage(
            { type: 'quackback:navigate', url: `${window.location.origin}/auth/login` },
            '*'
          )
          setIsSubmitting(false)
          return
        }
      } else if (!isIdentified) {
        const ok = await ensureSession()
        if (!ok) {
          setError('Could not create session. Please try again.')
          setIsSubmitting(false)
          return
        }
      }

      const [{ getWidgetAuthHeaders }, { createPublicPostFn }] = await Promise.all([
        import('@/lib/client/widget-auth'),
        import('@/lib/server/functions/public-posts'),
      ])
      const result = await createPublicPostFn({
        data: {
          boardId: selectedBoardId,
          title: title.trim(),
          content: content.trim(),
          metadata: metadata ?? undefined,
        },
        headers: getWidgetAuthHeaders(),
      })

      emitEvent('post:created', {
        id: result.id,
        title: result.title,
        board: result.board,
        statusId: result.statusId ?? null,
      })

      onPostCreated?.({
        id: result.id,
        title: result.title,
        voteCount: 0,
        statusId: result.statusId ?? null,
        board: result.board,
      })

      collapseForm()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmitForm = title.trim() && (!needsEmail || email.trim()) && (canPost || needsEmail)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="w-full px-3 pt-2 pb-3">
          <motion.div
            className="rounded-lg border border-border bg-card overflow-hidden"
            initial={false}
            animate={{
              boxShadow: expanded
                ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
                : '0 1px 2px 0 rgb(0 0 0 / 0.05)',
            }}
            transition={{ duration: 0.2 }}
          >
            <AnimatePresence>
              {expanded && boards.length > 1 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center px-3 pt-2.5 pb-0.5">
                    <span className="text-[11px] text-muted-foreground mr-1">Posting to</span>
                    <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                      <SelectTrigger
                        size="xs"
                        className="border-0 bg-transparent shadow-none font-medium text-foreground hover:text-foreground/80 focus-visible:ring-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {boards.map((b) => (
                          <SelectItem key={b.id} value={b.id} className="text-xs py-1">
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2.5 px-3 py-2.5">
              <AnimatePresence>
                {!expanded && (
                  <motion.div
                    initial={false}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8, width: 0, marginRight: -10 }}
                    transition={{ duration: 0.2 }}
                    className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center"
                  >
                    <PencilIcon className="w-3.5 h-3.5 text-primary" />
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.input
                ref={inputRef}
                type="text"
                placeholder="What's your idea?"
                value={title}
                onChange={(e) => {
                  const val = e.target.value
                  setTitle(val)
                  if (val && !expanded) setExpanded(true)
                  if (!val && expanded && !content.trim()) setExpanded(false)
                }}
                onFocus={() => {
                  if (title && !expanded) setExpanded(true)
                }}
                className="flex-1 bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/50 placeholder:font-normal caret-primary"
                initial={false}
                animate={{
                  fontSize: expanded ? '1rem' : '0.875rem',
                  fontWeight: expanded ? 600 : 400,
                }}
                transition={{ duration: 0.2 }}
              />
            </div>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden"
                >
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                    className="px-3 pb-2"
                  >
                    <textarea
                      placeholder="Add more details..."
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      maxLength={10000}
                      rows={3}
                      className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 border-0 outline-none caret-primary resize-none leading-relaxed"
                    />
                  </motion.div>

                  <AnimatePresence>
                    {!isSimilarSearching &&
                      similarPostResults &&
                      similarPostResults.posts.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-2">
                            <p className="text-[10px] font-medium text-muted-foreground/60 flex items-center gap-1 mb-1.5">
                              <LightBulbIcon className="w-3 h-3" />
                              Similar ideas
                            </p>
                            <div className="space-y-0.5">
                              {similarPostResults.posts.slice(0, 3).map((post) => (
                                <WidgetPostRow
                                  key={post.id}
                                  post={post}
                                  statusMap={statusMap}
                                  compact
                                  canVote={canVote}
                                  ensureSessionThen={ensureSessionThen}
                                  onAuthRequired={() => handleAuthRequired(post.id)}
                                  onSelect={() => onPostSelect?.(post.id)}
                                />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                  </AnimatePresence>

                  {error && (
                    <div className="px-3 pb-2">
                      <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {error}
                      </div>
                    </div>
                  )}

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2, delay: 0.15 }}
                    className="border-t border-border bg-muted/30"
                  >
                    {needsEmail && (
                      <div className="px-3 pt-2 pb-1 flex gap-2">
                        <input
                          type="email"
                          required
                          placeholder="Your email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={`flex-1 min-w-0 ${identityInputCls}`}
                        />
                        <input
                          type="text"
                          placeholder="Name (optional)"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className={`w-28 shrink-0 ${identityInputCls}`}
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between px-3 py-2">
                      <p className="text-[11px] text-muted-foreground truncate mr-2">
                        {user ? (
                          <>
                            Posting as{' '}
                            <span className="font-medium text-foreground">
                              {user.name || user.email}
                            </span>
                          </>
                        ) : needsEmail ? (
                          email.trim() ? (
                            <>
                              Posting as{' '}
                              <span className="font-medium text-foreground">{email.trim()}</span>
                            </>
                          ) : (
                            'Your email is required'
                          )
                        ) : (
                          'Posting anonymously'
                        )}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={collapseForm}
                          className="px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!canSubmitForm || isSubmitting}
                          className="px-3 py-1 text-[11px] font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                        >
                          {isSubmitting ? 'Submitting...' : 'Submit'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Popular ideas */}
          <div className="mt-2">
            <div className="flex items-center justify-between px-1 py-1.5">
              {popularSearchOpen ? (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <MagnifyingGlassIcon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                  <input
                    ref={popularSearchInputRef}
                    type="text"
                    value={popularSearch}
                    onChange={(e) => setPopularSearch(e.target.value)}
                    placeholder="Search ideas..."
                    className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setPopularSearchOpen(false)}
                    className="shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    <XMarkIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                    Popular ideas
                  </p>
                  <button
                    type="button"
                    onClick={() => setPopularSearchOpen(true)}
                    className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    aria-label="Search ideas"
                  >
                    <MagnifyingGlassIcon className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>

            {boards.length >= 2 && (
              <div className="relative mb-2">
                <div
                  ref={pills.ref}
                  className="flex gap-1 overflow-x-auto scrollbar-none px-1 pb-0.5"
                >
                  {boards.map((board) => (
                    <button
                      key={board.id}
                      type="button"
                      onClick={() =>
                        setActiveBoardSlug(activeBoardSlug === board.slug ? null : board.slug)
                      }
                      className={`rounded-full text-[11px] px-2 py-0.5 whitespace-nowrap transition-colors shrink-0 ${
                        activeBoardSlug === board.slug
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {board.name}
                    </button>
                  ))}
                </div>
                {pills.canScrollLeft && (
                  <button
                    type="button"
                    onClick={() => pills.scrollBy(-120)}
                    className="absolute left-0 top-0 bottom-0.5 flex items-center pl-0.5 pr-6 bg-gradient-to-r from-background via-background/80 to-transparent"
                    aria-label="Scroll left"
                  >
                    <ChevronLeftIcon className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
                {pills.canScrollRight && (
                  <button
                    type="button"
                    onClick={() => pills.scrollBy(120)}
                    className="absolute right-0 top-0 bottom-0.5 flex items-center pr-0.5 pl-6 bg-gradient-to-l from-background via-background/80 to-transparent"
                    aria-label="Scroll right"
                  >
                    <ChevronRightIcon className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            )}

            {debouncedPopularSearch.length > 0 && (
              <>
                {(isPopularSearchFetching || popularSearch !== debouncedPopularSearch) && (
                  <div className="flex justify-center py-4">
                    <span className="text-[10px] text-muted-foreground/50">Searching...</span>
                  </div>
                )}
                {!isPopularSearchFetching &&
                  popularSearch === debouncedPopularSearch &&
                  (popularSearchData?.posts.length ?? 0) === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <MagnifyingGlassIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
                      <p className="text-sm font-medium text-muted-foreground/70">No ideas found</p>
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        Try a different search term
                      </p>
                    </div>
                  )}
                {!isPopularSearchFetching &&
                  popularSearch === debouncedPopularSearch &&
                  (popularSearchData?.posts.length ?? 0) > 0 && (
                    <div className="space-y-0.5">
                      {popularSearchData!.posts.map((post) => (
                        <WidgetPostRow
                          key={post.id}
                          post={post}
                          statusMap={statusMap}
                          showBoard
                          canVote={canVote}
                          ensureSessionThen={ensureSessionThen}
                          onAuthRequired={() => handleAuthRequired(post.id)}
                          onSelect={() => onPostSelect?.(post.id)}
                        />
                      ))}
                    </div>
                  )}
              </>
            )}

            {debouncedPopularSearch.length === 0 && (
              <>
                {isFetchingPosts && !isFetchingNextPage && allPopularPosts.length === 0 && (
                  <div className="flex justify-center py-4">
                    <span className="text-[10px] text-muted-foreground/50">Loading...</span>
                  </div>
                )}
                {!isFetchingPosts && allPopularPosts.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <LightBulbIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm font-medium text-muted-foreground/70">
                      {activeBoardSlug ? 'No ideas in this board yet' : 'No ideas yet'}
                    </p>
                    {!activeBoardSlug && (
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        Be the first to share one!
                      </p>
                    )}
                  </div>
                )}
                {allPopularPosts.length > 0 && (
                  <div className="space-y-0.5">
                    {allPopularPosts.map((post) => (
                      <WidgetPostRow
                        key={post.id}
                        post={post}
                        statusMap={statusMap}
                        showBoard
                        canVote={canVote}
                        ensureSessionThen={ensureSessionThen}
                        onAuthRequired={() => handleAuthRequired(post.id)}
                        onSelect={() => onPostSelect?.(post.id)}
                      />
                    ))}
                    {hasNextPage && (
                      <div ref={postsSentinelRef} className="flex justify-center py-2">
                        {isFetchingNextPage && (
                          <span className="text-[10px] text-muted-foreground/50">Loading...</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  )
}
