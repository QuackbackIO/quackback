import { useCallback, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient, useQueries } from '@tanstack/react-query'
import { ChatBubbleLeftIcon } from '@heroicons/react/24/solid'
import { Route } from '@/routes/admin/feedback'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { InboxFiltersPanel } from '@/components/admin/feedback/inbox-filters'
import { FeedbackTableView } from '@/components/admin/feedback/table'
import { CreatePostDialog } from '@/components/admin/feedback/create-post-dialog'
import { ModerationPendingBanner } from '@/components/admin/feedback/moderation-pending-banner'
import { useInboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import { useInboxPosts, flattenInboxPosts, inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import type { CurrentUser } from '@/lib/shared/types'
import type { Board, PostTag, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/shared/types'
import type { PostId } from '@quackback/ids'
import { saveNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'

interface InboxContainerProps {
  boards: Board[]
  tags: PostTag[]
  statuses: PostStatusEntity[]
  members: TeamMember[]
  currentUser: CurrentUser
}

export function InboxContainer({
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

  // Server state - Posts list (with infinite query for pagination). The route
  // loader prefetches the default/unfiltered dataset into this same infinite
  // cache (QC-1: one shared query definition), so the unfiltered first paint
  // reads warm data; filtered views fetch on the client with keepPreviousData.
  const {
    data: postsData,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInboxPosts({ filters })

  const posts = useMemo(() => flattenInboxPosts(postsData), [postsData])

  // Fetch duplicate counts PER PAGE of the infinite query rather than keying one
  // query on the ever-growing flattened id array (QC-5): each page's id set is
  // stable once loaded, so its counts cache under a stable per-page key and only
  // a freshly-loaded page fires a new request — previously every "load more"
  // re-keyed and refetched counts for the entire accumulated list.
  const pageIdLists = useMemo(
    () => (postsData?.pages ?? []).map((page) => page.items.map((p) => p.id) as PostId[]),
    [postsData]
  )
  const countsQueries = useQueries({
    queries: pageIdLists.map((ids) => mergeSuggestionQueries.countsForPosts(ids)),
  })

  // Build a Map<postId, count> for efficient lookup, merging every page's counts.
  const duplicateCountByPostId = useMemo(() => {
    const map = new Map<PostId, number>()
    for (const query of countsQueries) {
      for (const item of query.data ?? []) {
        map.set(item.postId, item.count)
      }
    }
    return map.size > 0 ? map : undefined
    // Keyed on a fingerprint of each page-query's last-updated stamp so the memo
    // recomputes only when counts actually change (countsQueries is a fresh
    // array each render).
  }, [countsQueries.map((q) => q.dataUpdatedAt).join(',')])

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
      headerIcon={ChatBubbleLeftIcon}
      headerTitle="Feedback"
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
      <ModerationPendingBanner />
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
