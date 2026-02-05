import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { Spinner } from '@/components/shared/spinner'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { FeedbackHeader } from '@/components/public/feedback/feedback-header'
import { FeedbackSidebar } from '@/components/public/feedback/feedback-sidebar'
import { FeedbackToolbar } from '@/components/public/feedback/feedback-toolbar'
import { MobileBoardSheet } from '@/components/public/feedback/mobile-board-sheet'
import { usePublicFilters } from '@/components/public/feedback/use-public-filters'
import { PostCard, type PostCardDensity } from '@/components/public/post-card'
import type { BoardWithStats } from '@/lib/server/domains/boards'
import type { PostStatusEntity, Tag } from '@/lib/shared/db-types'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import {
  flattenPublicPosts,
  usePublicPosts,
  useVotedPosts,
} from '@/lib/client/hooks/use-portal-posts-query'
import type { PublicPostListItem } from '@/lib/server/domains/posts'
import { cn } from '@/lib/shared/utils'

interface FeedbackContainerProps {
  workspaceName: string
  workspaceSlug: string
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
  workspaceSlug,
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
}: FeedbackContainerProps): React.ReactElement {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const { filters, setFilters, activeFilterCount } = usePublicFilters()
  const [density, setDensity] = useState<PostCardDensity>('comfortable')

  // List key for animations - only updates when data finishes loading
  // This prevents double animations when filters change (stale data → new data)
  const filterKey = `${filters.board ?? currentBoard}-${filters.sort ?? currentSort}-${filters.search ?? currentSearch}-${(filters.status ?? []).join()}-${(filters.tagIds ?? []).join()}`
  const [listKey, setListKey] = useState(filterKey)

  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : user

  // Current filter values (URL state takes precedence over props)
  const activeBoard = filters.board ?? currentBoard
  const activeSearch = filters.search ?? currentSearch
  const activeSort = filters.sort ?? currentSort
  const activeStatuses = filters.status ?? []
  const activeTagIds = filters.tagIds ?? []

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
  // Show subtle loading indicator when fetching new filter results (not for pagination)
  const isLoading = isFetching && !isFetchingNextPage

  // Update list key only when loading completes to trigger animations
  // This ensures we animate the new data, not stale data during loading
  useEffect(() => {
    if (!isLoading && filterKey !== listKey) {
      setListKey(filterKey)
    }
  }, [filterKey, isLoading, listKey])

  // Track voted posts - TanStack Query is single source of truth
  // Optimistic updates handled by useVoteMutation's onMutate
  const { refetchVotedPosts } = useVotedPosts({
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

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  function handleSortChange(sort: 'top' | 'new' | 'trending'): void {
    setFilters({ sort })
  }

  function handleBoardChange(board: string | undefined): void {
    setFilters({ board })
  }

  function handleSearchChange(search: string): void {
    setFilters({ search: search || undefined })
  }

  function handleStatusChange(values: string[]): void {
    setFilters({ status: values.length > 0 ? values : undefined })
  }

  function handleTagChange(tagIds: string[]): void {
    setFilters({ tagIds: tagIds.length > 0 ? tagIds : undefined })
  }

  function handleClearFilters(): void {
    setFilters({ status: undefined, tagIds: undefined })
  }

  const currentBoardInfo = activeBoard ? boards.find((b) => b.slug === activeBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId

  function handlePostCreated(postId: string): void {
    setTimeout(() => {
      const postElement = document.querySelector(`[data-post-id="${postId}"]`)
      postElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  return (
    <div className="py-6">
      <div className="flex gap-8">
        <div className="flex-1 min-w-0">
          <FeedbackHeader
            workspaceName={workspaceName}
            boards={boards}
            defaultBoardId={boardIdForCreate}
            user={effectiveUser}
            onPostCreated={handlePostCreated}
          />

          {/* Mobile board selector + Toolbar */}
          <div className="flex items-center gap-2">
            <MobileBoardSheet
              boards={boards}
              currentBoard={activeBoard}
              onBoardChange={handleBoardChange}
            />
            <div className="flex-1">
              <FeedbackToolbar
                currentSort={activeSort}
                onSortChange={handleSortChange}
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
                density={density}
                onDensityChange={setDensity}
                isLoading={isLoading}
              />
            </div>
          </div>

          <div className="mt-3">
            {posts.length === 0 && !isLoading ? (
              <p className="text-muted-foreground text-center py-8">
                {activeSearch || activeFilterCount > 0
                  ? 'No posts match your filters.'
                  : 'No posts yet.'}
              </p>
            ) : (
              <>
                <div
                  key={listKey}
                  className={cn(
                    'rounded-lg overflow-hidden divide-y divide-border/30 bg-card border border-border/40 transition-opacity duration-150',
                    isLoading && 'opacity-60'
                  )}
                >
                  {posts.map((post, index) => (
                    <div
                      key={post.id}
                      className="animate-in fade-in slide-in-from-bottom-1 duration-200 fill-mode-backwards"
                      style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
                    >
                      <PostCard
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
                        isAuthenticated={!!effectiveUser}
                        density={density}
                      />
                    </div>
                  ))}
                </div>

                {/* Sentinel element for intersection observer */}
                {hasNextPage && (
                  <div ref={sentinelRef} className="py-4 flex justify-center">
                    {isFetchingNextPage && <Spinner />}
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
          workspaceSlug={workspaceSlug}
        />
      </div>
    </div>
  )
}
