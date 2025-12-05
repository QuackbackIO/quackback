'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { FeedbackHeader } from './feedback-header'
import { FeedbackToolbar } from './feedback-toolbar'
import { FeedbackSidebar } from './feedback-sidebar'
import { PostCard } from '@/components/public/post-card'
import { usePublicFilters } from './use-public-filters'
import type { BoardWithStats, PublicPostListItem } from '@quackback/db/queries/public'
import type { PostStatusEntity } from '@quackback/db'

interface PublicPostListResult {
  items: PublicPostListItem[]
  total: number
  hasMore: boolean
}

interface FeedbackContainerProps {
  organizationId: string
  organizationName: string
  boards: BoardWithStats[]
  posts: PublicPostListItem[]
  statuses: PostStatusEntity[]
  hasMore: boolean
  votedPostIds: string[]
  postAvatarUrls: Record<string, string | null>
  currentBoard?: string
  currentSearch?: string
  currentSort?: 'top' | 'new' | 'trending'
  defaultBoardId?: string
}

export function FeedbackContainer({
  organizationId,
  organizationName,
  boards,
  posts: initialPosts,
  statuses,
  hasMore: initialHasMore,
  votedPostIds,
  postAvatarUrls: initialAvatarUrls,
  currentBoard,
  currentSearch,
  currentSort = 'top',
  defaultBoardId,
}: FeedbackContainerProps) {
  const { filters, setFilters } = usePublicFilters()

  // Posts state
  const [posts, setPosts] = useState<PublicPostListItem[]>(initialPosts)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)

  // Refs
  const isInitialMount = useRef(true)
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<() => void>(() => {})

  const votedSet = useMemo(() => new Set(votedPostIds), [votedPostIds])

  // Current filter values
  const activeBoard = filters.board ?? currentBoard
  const activeSearch = filters.search ?? currentSearch
  const activeSort = filters.sort ?? currentSort

  // Fetch more posts
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return
    loadingRef.current = true
    setIsLoading(true)

    try {
      const nextPage = page + 1
      const params = new URLSearchParams({
        organizationId,
        page: nextPage.toString(),
        limit: '20',
      })
      if (activeBoard) params.set('board', activeBoard)
      if (activeSearch) params.set('search', activeSearch)
      if (activeSort) params.set('sort', activeSort)

      const res = await fetch(`/api/public/posts?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')

      const data: PublicPostListResult = await res.json()
      setPosts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id))
        const newItems = data.items.filter((item) => !existingIds.has(item.id))
        return [...prev, ...newItems]
      })
      setHasMore(data.hasMore)
      setPage(nextPage)
    } catch (err) {
      console.error('Error loading more posts:', err)
    } finally {
      loadingRef.current = false
      setIsLoading(false)
    }
  }, [organizationId, activeBoard, activeSearch, activeSort, hasMore, page])

  // Keep ref in sync with latest loadMore
  loadMoreRef.current = loadMore

  // Reset when filters change
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    // Filters changed - fetch fresh data from page 1
    const fetchFresh = async () => {
      loadingRef.current = true
      setIsLoading(true)
      setPosts([])

      try {
        const params = new URLSearchParams({
          organizationId,
          page: '1',
          limit: '20',
        })
        if (activeBoard) params.set('board', activeBoard)
        if (activeSearch) params.set('search', activeSearch)
        if (activeSort) params.set('sort', activeSort)

        const res = await fetch(`/api/public/posts?${params}`)
        if (!res.ok) throw new Error('Failed to fetch')

        const data: PublicPostListResult = await res.json()
        setPosts(data.items)
        setHasMore(data.hasMore)
        setPage(1)
      } catch (err) {
        console.error('Error fetching posts:', err)
      } finally {
        loadingRef.current = false
        setIsLoading(false)
      }
    }

    fetchFresh()
  }, [organizationId, activeBoard, activeSearch, activeSort])

  // Intersection observer for infinite scroll - uses ref to stay stable
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          loadMoreRef.current()
        }
      },
      { rootMargin: '100px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore]) // Only re-run when hasMore changes (sentinel appears/disappears)

  // Filter handlers
  const handleBoardChange = useCallback(
    (boardSlug: string | undefined) => setFilters({ board: boardSlug }),
    [setFilters]
  )

  const handleSortChange = useCallback(
    (sort: 'top' | 'new' | 'trending') => setFilters({ sort }),
    [setFilters]
  )

  const handleSearchChange = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters]
  )

  // Board for creating posts
  const currentBoardInfo = activeBoard ? boards.find((b) => b.slug === activeBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId

  return (
    <div className="py-6">
      <div className="flex gap-8">
        <div className="flex-1 min-w-0">
          <FeedbackHeader organizationName={organizationName} />

          <FeedbackToolbar
            currentSort={activeSort}
            currentSearch={activeSearch}
            onSortChange={handleSortChange}
            onSearchChange={handleSearchChange}
            boardId={boardIdForCreate}
          />

          <div className="mt-3">
            {posts.length === 0 && !isLoading ? (
              <p className="text-muted-foreground text-center py-8">
                {activeSearch ? 'No posts match your search.' : 'No posts yet.'}
              </p>
            ) : (
              <>
                <div className="rounded-lg overflow-hidden divide-y divide-border/50 bg-card shadow-md border border-border/50">
                  {posts.map((post) => (
                    <PostCard
                      key={post.id}
                      id={post.id}
                      title={post.title}
                      content={post.content}
                      status={post.status}
                      statuses={statuses}
                      voteCount={post.voteCount}
                      commentCount={post.commentCount}
                      authorName={post.authorName}
                      authorAvatarUrl={post.memberId ? initialAvatarUrls[post.memberId] : null}
                      createdAt={post.createdAt}
                      boardSlug={post.board?.slug || ''}
                      boardName={post.board?.name}
                      tags={post.tags}
                      hasVoted={votedSet.has(post.id)}
                    />
                  ))}
                </div>

                {/* Sentinel element for intersection observer */}
                {hasMore && (
                  <div ref={sentinelRef} className="py-4 flex justify-center">
                    {isLoading && (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <FeedbackSidebar
          boards={boards}
          currentBoard={activeBoard}
          onBoardChange={handleBoardChange}
        />
      </div>
    </div>
  )
}
