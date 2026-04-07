import { useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { Route } from '@/routes/admin/feedback'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { InboxFiltersPanel } from '@/components/admin/feedback/inbox-filters'
import { FeedbackTableView } from '@/components/admin/feedback/table'
import { CreatePostDialog } from '@/components/admin/feedback/create-post-dialog'
import { useInboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import { useInboxPosts, flattenInboxPosts, inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import type { CurrentUser } from '@/lib/shared/types'
import type { Board, Tag, InboxPostListResult, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/principals'
import type { PostId } from '@quackback/ids'
import { saveNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'

interface InboxContainerProps {
  initialPosts: InboxPostListResult
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  currentUser: CurrentUser
}

export function InboxContainer({
  initialPosts,
  boards,
  tags,
  statuses,
  members,
  currentUser,
}: InboxContainerProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const search = Route.useSearch()

  // URL-based filter state
  const {
    filters,
    setFilters,
    clearFilters,
    hasActiveFilters,
    toggleBoard,
    toggleStatus,
    toggleSegment,
  } = useInboxFilters()

  // Segments data for filter UI
  const { data: segments } = useSegments()

  // Track whether we're on the initial render (for using server-prefetched data)
  const isInitialRender = useRef(true)

  // Mark as no longer initial after first render
  useEffect(() => {
    isInitialRender.current = false
  }, [])

  // Only use initialData on first render before any filter changes
  const shouldUseInitialData = isInitialRender.current && !filters.search && !filters.owner

  // Server state - Posts list (with infinite query for pagination)
  const {
    data: postsData,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInboxPosts({
    filters,
    initialData: shouldUseInitialData ? initialPosts : undefined,
  })

  const posts = useMemo(() => flattenInboxPosts(postsData), [postsData])

  // Fetch duplicate counts for visible posts
  const postIds = useMemo(() => posts.map((p) => p.id) as PostId[], [posts])
  const { data: duplicateCounts } = useQuery(mergeSuggestionQueries.countsForPosts(postIds))

  // Build a Map<postId, count> for efficient lookup
  const duplicateCountByPostId = useMemo(() => {
    if (!duplicateCounts || duplicateCounts.length === 0) return undefined
    const map = new Map<PostId, number>()
    for (const item of duplicateCounts) {
      map.set(item.postId, item.count)
    }
    return map
  }, [duplicateCounts])

  // Handlers
  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      fetchNextPage()
    }
  }, [hasMore, isLoadingMore, fetchNextPage])

  const handleNavigateToPost = useCallback(
    (postId: string) => {
      // Save navigation context for prev/next navigation in modal
      const backUrl = window.location.pathname + window.location.search
      saveNavigationContext(
        posts.map((p) => p.id),
        backUrl
      )

      // Open modal by adding post param to URL
      navigate({
        to: '/admin/feedback',
        search: {
          ...search,
          post: postId,
        },
      })
    },
    [navigate, posts, search]
  )

  const refetchPosts = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: inboxKeys.list(filters),
    })
  }, [queryClient, filters])

  return (
    <InboxLayout
      hasActiveFilters={hasActiveFilters}
      filters={
        <InboxFiltersPanel
          filters={filters}
          onFiltersChange={setFilters}
          boards={boards}
          tags={tags}
          statuses={statuses}
          segments={segments}
        />
      }
    >
      <FeedbackTableView
        posts={posts}
        statuses={statuses}
        boards={boards}
        tags={tags}
        members={members}
        segments={segments}
        filters={filters}
        onFiltersChange={setFilters}
        hasMore={!!hasMore}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        onNavigateToPost={handleNavigateToPost}
        onLoadMore={handleLoadMore}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onToggleStatus={toggleStatus}
        onToggleBoard={toggleBoard}
        onToggleSegment={toggleSegment}
        duplicateCountByPostId={duplicateCountByPostId}
        headerAction={
          <CreatePostDialog
            boards={boards}
            tags={tags}
            statuses={statuses}
            currentUser={currentUser}
            onPostCreated={refetchPosts}
          />
        }
      />
    </InboxLayout>
  )
}
