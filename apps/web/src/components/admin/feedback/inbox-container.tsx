import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
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
import { signalQueries } from '@/lib/client/queries/signals'
import type { CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { Board, Tag, InboxPostListResult, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/principals'
import type { AiSignalType, PostSignalCounts } from '@/lib/server/domains/signals'
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

  // Signal filter state
  const [activeSignalFilter, setActiveSignalFilter] = useState<AiSignalType | undefined>()

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

  // Fetch signal counts for visible posts
  const postIds = useMemo(() => posts.map((p) => p.id) as PostId[], [posts])
  const { data: signalCounts } = useQuery(signalQueries.countsForPosts(postIds))

  // Build a Map<postId, PostSignalCounts[]> for efficient lookup
  const signalsByPostId = useMemo(() => {
    if (!signalCounts || signalCounts.length === 0) return undefined
    const map = new Map<PostId, PostSignalCounts[]>()
    for (const signal of signalCounts) {
      const existing = map.get(signal.postId) ?? []
      existing.push(signal)
      map.set(signal.postId, existing)
    }
    return map
  }, [signalCounts])

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
        signalsByPostId={signalsByPostId}
        activeSignalFilter={activeSignalFilter}
        onSignalFilter={setActiveSignalFilter}
        headerAction={
          <CreatePostDialog
            boards={boards}
            tags={tags}
            statuses={statuses}
            onPostCreated={refetchPosts}
          />
        }
      />
    </InboxLayout>
  )
}
