import { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Route } from '@/routes/admin/feedback'
import { InboxLayout } from '@/components/admin/feedback/inbox-layout'
import { InboxFiltersPanel } from '@/components/admin/feedback/inbox-filters'
import { FeedbackTableView } from '@/components/admin/feedback/table'
import { CreatePostDialog } from '@/components/admin/feedback/create-post-dialog'
import { useInboxFilters } from '@/components/admin/feedback/use-inbox-filters'
import { useInboxPosts, flattenInboxPosts, inboxKeys } from '@/lib/client/hooks/use-inbox-query'
import { useUpdatePostStatus } from '@/lib/client/mutations/posts'
import type { PostId, StatusId } from '@quackback/ids'
import type { CurrentUser } from '@/components/admin/feedback/inbox-types'
import type { Board, Tag, InboxPostListResult, PostStatusEntity } from '@/lib/shared/db-types'
import type { TeamMember } from '@/lib/server/domains/members'
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
    selectedPostId,
    setSelectedPostId,
    hasActiveFilters,
    toggleBoard,
    toggleStatus,
  } = useInboxFilters()

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

  const posts = flattenInboxPosts(postsData)

  // Mutations
  const updateStatus = useUpdatePostStatus()

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

  const handleStatusChange = useCallback(
    (postId: string, statusId: StatusId) => {
      updateStatus.mutate({ postId: postId as PostId, statusId })
    },
    [updateStatus]
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
        />
      }
    >
      <FeedbackTableView
        posts={posts}
        statuses={statuses}
        boards={boards}
        tags={tags}
        members={members}
        filters={filters}
        onFiltersChange={setFilters}
        hasMore={!!hasMore}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        focusedPostId={selectedPostId}
        onFocusPost={setSelectedPostId}
        onNavigateToPost={handleNavigateToPost}
        onLoadMore={handleLoadMore}
        sort={filters.sort}
        onSortChange={(sort) => setFilters({ sort })}
        search={filters.search}
        onSearchChange={(search) => setFilters({ search })}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onToggleStatus={toggleStatus}
        onToggleBoard={toggleBoard}
        onStatusChange={handleStatusChange}
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
