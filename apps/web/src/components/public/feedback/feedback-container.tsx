import { useEffect, useCallback, useRef, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { FeedbackHeader } from '@/components/public/feedback/feedback-header'
import { FeedbackToolbar } from '@/components/public/feedback/feedback-toolbar'
import { FeedbackSidebar } from '@/components/public/feedback/feedback-sidebar'
import { PostCard } from '@/components/public/post-card'
import { usePublicFilters } from '@/components/public/feedback/use-public-filters'
import {
  usePublicPosts,
  flattenPublicPosts,
  useVotedPosts,
} from '@/lib/hooks/use-public-posts-query'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useAuthBroadcast } from '@/lib/hooks/use-auth-broadcast'
import type { BoardWithStats } from '@/lib/boards'
import type { PublicPostListItem } from '@/lib/posts'
import type { PostStatusEntity, Tag } from '@/lib/db-types'

interface FeedbackContainerProps {
  workspaceName: string
  boards: BoardWithStats[]
  posts: PublicPostListItem[]
  statuses: PostStatusEntity[]
  tags: Tag[]
  hasMore: boolean
  votedPostIds: string[]
  postAvatarUrls: Record<string, string | null>
  currentBoard?: string
  currentSearch?: string
  currentSort?: 'top' | 'new' | 'trending'
  defaultBoardId?: string
  /** User info if authenticated */
  user?: { name: string | null; email: string } | null
}

export function FeedbackContainer({
  workspaceName,
  boards,
  posts: initialPosts,
  statuses,
  tags,
  hasMore: initialHasMore,
  votedPostIds,
  postAvatarUrls: initialAvatarUrls,
  currentBoard,
  currentSearch,
  currentSort = 'top',
  defaultBoardId,
  user,
}: FeedbackContainerProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const { filters, setFilters, activeFilterCount } = usePublicFilters()

  // Get user from session
  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : user

  // Refs for intersection observer
  const sentinelRef = useRef<HTMLDivElement>(null)
  const fetchNextPageRef = useRef<() => void>(() => {})

  // Current filter values (URL state takes precedence over props)
  const activeBoard = filters.board ?? currentBoard
  const activeSearch = filters.search ?? currentSearch
  const activeSort = filters.sort ?? currentSort
  const activeStatuses = useMemo(() => filters.status ?? [], [filters.status])
  const activeTagIds = useMemo(() => filters.tagIds ?? [], [filters.tagIds])

  // Build merged filters for the query
  const mergedFilters = useMemo(
    () => ({
      board: activeBoard,
      search: activeSearch,
      sort: activeSort,
      status: activeStatuses.length > 0 ? activeStatuses : undefined,
      tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
    }),
    [activeBoard, activeSearch, activeSort, activeStatuses, activeTagIds]
  )

  // Track initial filters from server props to know when to use initialData
  const initialFiltersRef = useRef({
    board: currentBoard,
    search: currentSearch,
    sort: currentSort,
  })

  // Only use initialData when current filters match what the server rendered
  const filtersMatchInitial =
    mergedFilters.board === initialFiltersRef.current.board &&
    mergedFilters.search === initialFiltersRef.current.search &&
    mergedFilters.sort === initialFiltersRef.current.sort &&
    !mergedFilters.status?.length &&
    !mergedFilters.tagIds?.length

  // Server state - Posts list using TanStack Query
  const {
    data: postsData,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = usePublicPosts({
    filters: mergedFilters,
    initialData: filtersMatchInitial
      ? {
          items: initialPosts,
          total: initialPosts.length,
          hasMore: initialHasMore,
        }
      : undefined,
  })

  const posts = flattenPublicPosts(postsData)
  const isLoading = isFetching && !isFetchingNextPage

  // Track voted posts in client state (syncs with server on vote)
  const { hasVoted, toggleVote, refetchVotedPosts } = useVotedPosts({
    initialVotedIds: votedPostIds,
  })

  // Track auth state to detect login/logout
  const isAuthenticated = !!effectiveUser
  const prevAuthRef = useRef(isAuthenticated)

  // Refetch voted posts when auth state changes (login or logout)
  useEffect(() => {
    if (prevAuthRef.current !== isAuthenticated) {
      prevAuthRef.current = isAuthenticated
      refetchVotedPosts()
    }
  }, [isAuthenticated, refetchVotedPosts])

  // Listen for auth success via broadcast (for popup OAuth flows)
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
  })

  // Keep ref in sync with latest fetchNextPage
  fetchNextPageRef.current = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchNextPageRef.current()
        }
      },
      { rootMargin: '100px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage])

  // Filter handlers
  const handleSearchChange = useCallback(
    (search: string) => setFilters({ search: search || undefined }),
    [setFilters]
  )

  const handleStatusChange = useCallback(
    (statuses: string[]) => setFilters({ status: statuses.length > 0 ? statuses : undefined }),
    [setFilters]
  )

  const handleTagChange = useCallback(
    (tagIds: string[]) => setFilters({ tagIds: tagIds.length > 0 ? tagIds : undefined }),
    [setFilters]
  )

  const handleClearFilters = useCallback(
    () => setFilters({ status: undefined, tagIds: undefined }),
    [setFilters]
  )

  // Board for creating posts
  const currentBoardInfo = activeBoard ? boards.find((b) => b.slug === activeBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId

  return (
    <div className="py-6">
      <div className="flex gap-8">
        <div className="flex-1 min-w-0">
          <FeedbackHeader
            workspaceName={workspaceName}
            boards={boards}
            defaultBoardId={boardIdForCreate}
            user={effectiveUser}
            onPostCreated={(postId) => {
              // Scroll to the new post after a short delay to allow the DOM to update
              setTimeout(() => {
                const postElement = document.querySelector(`[data-post-id="${postId}"]`)
                postElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }, 100)
            }}
          />

          <FeedbackToolbar
            currentSort={activeSort}
            currentSearch={activeSearch}
            onSearchChange={handleSearchChange}
            statuses={statuses}
            tags={tags}
            selectedStatuses={activeStatuses}
            selectedTagIds={activeTagIds}
            onStatusChange={handleStatusChange}
            onTagChange={handleTagChange}
            onClearFilters={handleClearFilters}
            activeFilterCount={activeFilterCount}
          />

          <div className="mt-3">
            {posts.length === 0 && !isLoading ? (
              <p className="text-muted-foreground text-center py-8">
                {activeSearch || activeFilterCount > 0
                  ? 'No posts match your filters.'
                  : 'No posts yet.'}
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
                      statusId={post.statusId}
                      statuses={statuses}
                      voteCount={post.voteCount}
                      commentCount={post.commentCount}
                      authorName={post.authorName}
                      authorAvatarUrl={post.memberId ? initialAvatarUrls[post.memberId] : null}
                      createdAt={post.createdAt}
                      boardSlug={post.board?.slug || ''}
                      boardName={post.board?.name}
                      tags={post.tags}
                      hasVoted={hasVoted(post.id)}
                      onVoteChange={toggleVote}
                      isAuthenticated={!!effectiveUser}
                    />
                  ))}
                </div>

                {/* Sentinel element for intersection observer */}
                {hasNextPage && (
                  <div ref={sentinelRef} className="py-4 flex justify-center">
                    {isFetchingNextPage && (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <FeedbackSidebar boards={boards} currentBoard={activeBoard} />
      </div>
    </div>
  )
}
