import { useEffect, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { Spinner } from '@/components/shared/spinner'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { FeedbackHeader } from '@/components/public/feedback/feedback-header'
import { FeedbackSidebar } from '@/components/public/feedback/feedback-sidebar'
import { FeedbackToolbar } from '@/components/public/feedback/feedback-toolbar'
import {
  PublicFiltersBar,
  PublicFiltersToolbarButton,
} from '@/components/public/feedback/public-filters-bar'
import { usePublicFilters } from '@/components/public/feedback/use-public-filters'
import { PortalModerationSection } from '@/components/public/feedback/portal-moderation-section'
import { PostCard } from '@/components/public/post-card'
import type { PublicBoardWithStats } from '@/lib/shared/types'
import type { PostStatusEntity, PostTag } from '@/lib/shared/db-types'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import {
  flattenPublicPosts,
  publicPostsKeys,
  usePublicPosts,
  useVotedPosts,
} from '@/lib/client/hooks/use-portal-posts-query'
import { useChangePostStatusId } from '@/lib/client/mutations/posts'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PublicPostListItem } from '@/lib/shared/types'
import { cn } from '@/lib/shared/utils'
import type { PostId, PostStatusId } from '@quackback/ids'

interface FeedbackContainerProps {
  workspaceName: string
  workspaceSlug: string
  boards: PublicBoardWithStats[]
  posts: PublicPostListItem[]
  statuses: PostStatusEntity[]
  tags: PostTag[]
  hasMore: boolean
  votedPostIds: string[]
  currentBoard?: string
  currentSearch?: string
  currentSort?: 'top' | 'new' | 'trending'
  defaultBoardId?: string
  /** User info if authenticated */
  user?: { name: string | null; email: string } | null
  /**
   * Per-board submit/vote capability for the current viewer, keyed by board id
   * (server-computed). Vote permission is per-board, so this one map gates
   * every card — including infinite-scroll pages — and the submit CTA.
   */
  boardPermissions?: Record<string, { canSubmit: boolean; canVote: boolean }>
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
  currentBoard,
  currentSearch,
  currentSort = 'trending',
  defaultBoardId,
  user,
  boardPermissions,
}: FeedbackContainerProps): React.ReactElement {
  const intl = useIntl()
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const { filters, setFilters, clearFilters, activeFilterCount } = usePublicFilters()
  const queryClient = useQueryClient()
  const { can } = usePortalPermissions()
  const changeStatus = useChangePostStatusId()
  // Team members with post.set_status get an inline status dropdown on the
  // portal feed; end users and visitors keep the static badge.
  const canSetStatus = can(PERMISSIONS.POST_SET_STATUS)
  // Holders of post.approve get the inline moderation section (banner + pending
  // cards).
  const canApprove = can(PERMISSIONS.POST_APPROVE)

  // List key for animations - only updates when data finishes loading
  // This prevents double animations when filters change (stale data → new data)
  const filterKey = `${filters.board ?? currentBoard}-${filters.sort ?? currentSort}-${filters.search ?? currentSearch}-${(filters.status ?? []).join()}-${(filters.tagIds ?? []).join()}-${filters.minVotes ?? ''}-${filters.dateFrom ?? ''}-${filters.responded ?? ''}-${filters.owner ?? ''}-${(filters.segmentIds ?? []).join()}`
  const [listKey, setListKey] = useState(filterKey)

  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email }
    : user
  // A real (non-anonymous) signed-in user. Drives the vote button's authz vs
  // authn copy: a denied real user sees "no access"; a denied anonymous / no-
  // session viewer gets the sign-in path. Anonymous sessions also populate
  // session.user, so !!effectiveUser is not the right signal here.
  const isRealUser = !!session?.user && session.user.principalType !== 'anonymous'

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
      minVotes: filters.minVotes,
      dateFrom: filters.dateFrom,
      responded: filters.responded,
      // Team-only filters (owner, segments). Ignored server-side for callers
      // without post.view_private, so passing them through is always safe.
      owner: filters.owner,
      segmentIds: filters.segmentIds,
    }),
    [
      activeBoard,
      activeSearch,
      activeSort,
      activeStatuses,
      activeTagIds,
      filters.minVotes,
      filters.dateFrom,
      filters.responded,
      filters.owner,
      filters.segmentIds,
    ]
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
    !mergedFilters.tagIds?.length &&
    !mergedFilters.minVotes &&
    !mergedFilters.dateFrom &&
    !mergedFilters.responded

  // Server state - Posts list using TanStack Query
  const {
    data: postsData,
    isFetching,
    isFetchingNextPage,
    isPending,
    isPlaceholderData,
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
  // Dim the list only during an actual filter transition (placeholderData is
  // still showing the previous filter's results while the new ones load) —
  // NOT on every background refetch (e.g. the SSE-adjacent/interval refetches
  // that happen with fresh data already in cache), which used to dim the feed
  // on any isFetching tick.
  const isLoading = isFetching && isPlaceholderData && !isFetchingNextPage

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

  const currentBoardInfo = activeBoard ? boards.find((b) => b.slug === activeBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId

  function handlePostCreated(postId: string): void {
    setTimeout(() => {
      const postElement = document.querySelector(`[data-post-id="${postId}"]`)
      postElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  // Write the new statusId straight into the feed's infinite-query cache so the
  // badge updates immediately, no refetch flicker. Keyed by mergedFilters to
  // match the live usePublicPosts query.
  function patchFeedStatus(postId: PostId, statusId: PostStatusId | null): void {
    queryClient.setQueryData<InfiniteData<{ items: PublicPostListItem[] }>>(
      publicPostsKeys.list(mergedFilters),
      (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((p) => (p.id === postId ? { ...p, statusId } : p)),
              })),
            }
          : old
    )
  }

  // Optimistically apply a status, fire the mutation, and roll back on failure.
  // Shared by the dropdown change and the undo action (undo just targets the
  // previous statusId). Invalidates the feed on settle to reconcile with server.
  async function applyStatusChange(
    postId: PostId,
    statusId: PostStatusId,
    previousStatusId: PostStatusId | null
  ): Promise<void> {
    patchFeedStatus(postId, statusId)
    try {
      await changeStatus.mutateAsync({ postId, statusId })
    } catch {
      patchFeedStatus(postId, previousStatusId)
      toast.error(
        intl.formatMessage({
          id: 'portal.postCard.statusChange.error',
          defaultMessage: 'Failed to update status',
        })
      )
      return
    } finally {
      queryClient.invalidateQueries({ queryKey: publicPostsKeys.lists() })
    }
  }

  function handleStatusChange(post: PublicPostListItem, statusId: PostStatusId): void {
    const previousStatusId = post.statusId
    if (previousStatusId === statusId) return
    void applyStatusChange(post.id, statusId, previousStatusId)
    const newStatus = statuses.find((s) => s.id === statusId)
    toast(
      intl.formatMessage(
        {
          id: 'portal.postCard.statusChange.toast',
          defaultMessage: 'Status updated to {status}',
        },
        { status: newStatus?.name ?? statusId }
      ),
      {
        duration: 5000,
        action: {
          label: intl.formatMessage({
            id: 'portal.postCard.statusChange.undo',
            defaultMessage: 'Undo',
          }),
          onClick: () => {
            if (previousStatusId) void applyStatusChange(post.id, previousStatusId, statusId)
          },
        },
      }
    )
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
            boardPermissions={boardPermissions}
            onPostCreated={handlePostCreated}
          />

          <FeedbackToolbar
            currentSort={activeSort}
            onSortChange={handleSortChange}
            currentSearch={activeSearch}
            onSearchChange={handleSearchChange}
            isLoading={isLoading}
            filterButton={
              <PublicFiltersToolbarButton
                filters={filters}
                setFilters={setFilters}
                statuses={statuses}
                tags={tags}
                boards={boards}
              />
            }
          />
          <div className="mt-3">
            <PublicFiltersBar
              filters={filters}
              setFilters={setFilters}
              clearFilters={clearFilters}
              statuses={statuses}
              tags={tags}
              boards={boards}
            />
          </div>

          <PortalModerationSection enabled={canApprove} />

          <div className="mt-5">
            {posts.length === 0 && !isPending ? (
              activeSearch || activeFilterCount > 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {intl.formatMessage({
                    id: 'portal.feedback.list.noPostsFiltered',
                    defaultMessage: 'No posts match your filters.',
                  })}
                </p>
              ) : (
                <div className="text-center py-10 px-4 space-y-3">
                  <p className="text-base font-medium text-foreground">
                    {intl.formatMessage({
                      id: 'portal.feedback.list.noPostsYetTitle',
                      defaultMessage: 'Got an idea? Be the first to share it',
                    })}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {intl.formatMessage(
                      {
                        id: 'portal.feedback.list.noPostsYetDescription',
                        defaultMessage: 'The {workspace} team reads every request.',
                      },
                      { workspace: workspaceName }
                    )}
                  </p>
                </div>
              )
            ) : (
              <>
                <div
                  key={listKey}
                  className={cn(
                    'space-y-3 transition-opacity duration-150',
                    isLoading && 'opacity-60'
                  )}
                >
                  {posts.map((post, index) => (
                    <div
                      key={post.id}
                      className="bg-card border border-border/40 rounded-lg overflow-hidden animate-in fade-in duration-200 fill-mode-backwards"
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
                        authorPrincipalId={post.principalId}
                        createdAt={post.createdAt}
                        boardSlug={post.board?.slug || ''}
                        tags={post.tags}
                        isAuthenticated={isRealUser}
                        canVote={
                          post.board ? (boardPermissions?.[post.board.id]?.canVote ?? false) : false
                        }
                        canChangeStatus={canSetStatus}
                        onStatusChange={(statusId) => handleStatusChange(post, statusId)}
                        isUpdatingStatus={changeStatus.isPending}
                        showAvatar={false}
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
