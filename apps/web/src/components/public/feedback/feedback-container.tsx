import { useEffect, useMemo, useRef, useState } from 'react'
import { useIntl, type MessageDescriptor } from 'react-intl'
import { toast } from 'sonner'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { useRouter } from '@tanstack/react-router'
import { FeedbackHeader } from '@/components/public/feedback/feedback-header'
import { FeedbackSidebar } from '@/components/public/feedback/feedback-sidebar'
import { PortalPoweredBy } from '@/components/public/feedback/portal-powered-by'
import { PortalFilterPanel } from '@/components/public/feedback/portal-filter-panel'
import { PortalFilterSheet } from '@/components/public/feedback/portal-filter-sheet'
import { FeedbackToolbar } from '@/components/public/feedback/feedback-toolbar'
import {
  PublicMoreFilters,
  PublicFiltersBar,
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
  useFirstPage,
  useVotedPosts,
} from '@/lib/client/hooks/use-portal-posts-query'
import { useChangePostStatusId } from '@/lib/client/mutations/posts'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useApprovePost, useRejectPost } from '@/lib/client/mutations/moderation'
import type { PublicPostListItem } from '@/lib/shared/types'
import {
  sortForSearch,
  type PublicFeedbackFilters,
  type PublicFeedView,
  type PublicPostFacetCounts,
  type PublicPostSort,
  type WidenedSearch,
} from '@/lib/shared/types/filters'
import { cn } from '@/lib/shared/utils'
import type { PostId, PostStatusId } from '@quackback/ids'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import { toggleItem } from '@/components/shared/filter-utils'
import { shownName } from '@/lib/shared/greeting-name'
import { useFeedHandoff } from '@/components/public/feedback/feed-input-handoff'

const EMPTY_VIEW_MESSAGES: Record<PublicFeedView, MessageDescriptor> = {
  mine: {
    id: 'portal.feedback.list.emptyMine',
    defaultMessage: "You haven't posted any ideas yet.",
  },
  voted: {
    id: 'portal.feedback.list.emptyVoted',
    defaultMessage: "You haven't voted on any ideas yet.",
  },
  following: {
    id: 'portal.feedback.list.emptyFollowing',
    defaultMessage: "You aren't following any ideas yet.",
  },
}

const WIDENED_SEARCH_MESSAGES: Record<WidenedSearch, MessageDescriptor> = {
  most: {
    id: 'portal.feedback.list.searchWidenedMost',
    defaultMessage: 'No idea has all your words. Showing ideas with most of them.',
  },
  similar: {
    id: 'portal.feedback.list.searchWidenedSimilar',
    defaultMessage: 'No exact matches. Showing ideas with a similar spelling.',
  },
}

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
  currentSort?: PublicPostSort
  /** The sort when the visitor has not picked one, which clearing a search returns to. */
  defaultSort?: 'trending' | 'top' | 'new'
  defaultBoardId?: string
  /** User info if authenticated */
  user?: { name: string | null; email: string } | null
  /**
   * Per-board submit/vote capability for the current viewer, keyed by board id
   * (server-computed). Vote permission is per-board, so this one map gates
   * every card — including infinite-scroll pages — and the submit CTA.
   */
  boardPermissions?: Record<string, { canSubmit: boolean; canVote: boolean }>
  showPoweredBy?: boolean
  /** Filter panel counts as rendered on the server. */
  facets?: PublicPostFacetCounts | null
  /** How the server-rendered search was widened, if it was. */
  searchMode?: WidenedSearch
  /**
   * The filters `posts` were fetched for. The visitor can change filters while
   * they load, so these can differ from the current ones by the time they
   * arrive.
   */
  postsFilters: PublicFeedbackFilters
}

/**
 * Whether a signed-in visitor can post a new idea. On a board the composer is
 * locked to that board, so it decides; on the whole feed any board will do.
 */
export function canPostTo(
  boardPermissions: Record<string, { canSubmit: boolean }> | undefined,
  lockedBoardId: string | undefined
): boolean {
  if (lockedBoardId) return !!boardPermissions?.[lockedBoardId]?.canSubmit
  return Object.values(boardPermissions ?? {}).some((board) => board.canSubmit)
}

const isEmpty = (value: unknown): boolean =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

/**
 * Whether posts fetched for `postsFor` are the first page for `filters`, so
 * they can seed the feed. Only the plain feed is seeded: any narrowing filter
 * on either side makes the feed fetch its own first page.
 */
export function postsMatchFilters(
  postsFor: PublicFeedbackFilters,
  filters: PublicFeedbackFilters
): boolean {
  const narrowing = ['status', 'tagIds', 'minVotes', 'dateFrom', 'responded'] as const
  if (narrowing.some((key) => !isEmpty(postsFor[key]) || !isEmpty(filters[key]))) return false
  return (
    postsFor.board === filters.board &&
    postsFor.search === filters.search &&
    (postsFor.sort ?? 'trending') === (filters.sort ?? 'trending') &&
    postsFor.view === filters.view &&
    postsFor.owner === filters.owner &&
    (postsFor.segmentIds ?? []).join() === (filters.segmentIds ?? []).join()
  )
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
  defaultSort = 'trending',
  defaultBoardId,
  user,
  boardPermissions,
  showPoweredBy = true,
  facets,
  searchMode: initialSearchMode,
  postsFilters,
}: FeedbackContainerProps): React.ReactElement {
  const intl = useIntl()
  const router = useRouter()
  const session = useSessionContext()
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
  const approvePost = useApprovePost()
  const rejectPost = useRejectPost()

  // List key for animations - only updates when data finishes loading
  // This prevents double animations when filters change (stale data → new data)
  const filterKey = `${filters.board ?? currentBoard}-${filters.sort ?? currentSort}-${filters.search ?? currentSearch}-${(filters.status ?? []).join()}-${(filters.tagIds ?? []).join()}-${filters.minVotes ?? ''}-${filters.dateFrom ?? ''}-${filters.responded ?? ''}-${filters.owner ?? ''}-${(filters.segmentIds ?? []).join()}-${filters.view ?? ''}`
  const [listKey, setListKey] = useState(filterKey)

  const effectiveUser = session?.user
    ? { name: shownName(session.user.name, session.user.email), email: session.user.email }
    : user
  // A real (non-anonymous) signed-in user. Drives the vote button's authz vs
  // authn copy: a denied real user sees "no access"; a denied anonymous / no-
  // session viewer gets the sign-in path. Anonymous sessions also populate
  // session.user, so !!effectiveUser is not the right signal here.
  const isRealUser = !!session?.user && session.user.principalType !== 'anonymous'
  // Views are for signed-in users; the server ignores one from anyone else.
  const activeView = isRealUser ? filters.view : undefined

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
      view: activeView,
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
      activeView,
    ]
  )

  // Seed the feed with the server's posts only while the filters are still
  // the ones they were fetched for. Views are ignored for anyone not signed
  // in, on the server as here.
  const filtersMatchInitial = postsMatchFilters(
    { ...postsFilters, view: isRealUser ? postsFilters.view : undefined },
    mergedFilters
  )

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
    viewerKey: session?.user?.email,
    initialData: filtersMatchInitial
      ? {
          items: initialPosts,
          total: initialPosts.length,
          hasMore: initialHasMore,
          facets: facets ?? undefined,
          searchMode: initialSearchMode,
        }
      : undefined,
  })

  // Filter panel counts ride on the first page of the feed.
  const firstPage = useFirstPage(postsData)
  const facetCounts = firstPage?.facets
  // Set when nothing matched every word and the search was widened.
  const widenedSearch = activeSearch ? firstPage?.searchMode : undefined

  // A view the server ignores is not counted as on.
  const filterCount = activeFilterCount - (filters.view && !activeView ? 1 : 0)
  // An empty board is still a place to post the first idea, so the board
  // alone doesn't make the feed "filtered".
  const narrowingCount = filterCount - (filters.board ? 1 : 0)

  // One panel, shown in the sidebar on wide screens and in a sheet below that.
  const filterPanel = (layout: 'sidebar' | 'sheet') => (
    <PortalFilterPanel
      filters={mergedFilters}
      setFilters={setFilters}
      boards={boards}
      statuses={statuses}
      tags={tags}
      counts={facetCounts}
      showViews={isRealUser}
      layout={layout}
      footer={
        <PublicMoreFilters
          filters={filters}
          setFilters={setFilters}
          size={layout === 'sheet' ? 'md' : 'sm'}
        />
      }
    />
  )

  const poweredBy = showPoweredBy ? <PortalPoweredBy workspaceSlug={workspaceSlug} /> : null

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

  function handleSortChange(sort: PublicPostSort): void {
    setFilters({ sort })
  }

  function handleSearchChange(search: string): void {
    setFilters({
      search: search || undefined,
      sort: sortForSearch(activeSort, activeSearch, search, defaultSort),
    })
  }

  const currentBoardInfo = activeBoard ? boards.find((b) => b.slug === activeBoard) : boards[0]
  const boardIdForCreate = currentBoardInfo?.id || defaultBoardId
  // A selected board is page context (sidebar / ?board=), not a choice the
  // submit form should switch away from.
  const boardLocked = Boolean(activeBoard)

  // The composer opened from a search that found nothing, with its words as
  // the title. Signed-out visitors get the composer's own sign-in path.
  const [draft, setDraft] = useState<{ title: string; key: number }>()
  const handoff = useFeedHandoff()
  // A title typed (or a click) into the loading feed's composer opens it too.
  // Taken in an effect: the loading composer hands it over in its cleanup,
  // which React runs before this mounts.
  useEffect(() => {
    const title = handoff?.take('composeTitle')
    if (title !== undefined) setDraft({ title, key: Date.now() })
  }, [handoff])
  const canStartIdea =
    !isRealUser || canPostTo(boardPermissions, boardLocked ? boardIdForCreate : undefined)

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
    <div data-qb-section="feed">
      <div className="flex gap-6 lg:gap-8 [[data-qb-filters=start]_&]:flex-row-reverse">
        <div className="flex-1 min-w-0">
          <FeedbackHeader
            workspaceName={workspaceName}
            boards={boards}
            defaultBoardId={boardIdForCreate}
            user={effectiveUser}
            boardPermissions={boardPermissions}
            onPostCreated={handlePostCreated}
            boardLocked={boardLocked}
            draft={draft}
          />

          <FeedbackToolbar
            currentSort={activeSort}
            onSortChange={handleSortChange}
            currentSearch={activeSearch}
            onSearchChange={handleSearchChange}
            filterButton={
              <div className="lg:hidden">
                <PortalFilterSheet activeCount={filterCount} footer={poweredBy}>
                  {filterPanel('sheet')}
                </PortalFilterSheet>
              </div>
            }
          />
          <div className="mt-3 empty:hidden">
            <PublicFiltersBar
              filters={mergedFilters}
              setFilters={setFilters}
              clearFilters={clearFilters}
              statuses={statuses}
              tags={tags}
              boards={boards}
              counts={facetCounts}
            />
          </div>
          {facetCounts && (
            <p role="status" className="sr-only">
              {intl.formatMessage(
                {
                  id: 'portal.feedback.list.resultCount',
                  defaultMessage: '{count, plural, one {# idea} other {# ideas}}',
                },
                { count: facetCounts.total }
              )}
            </p>
          )}

          <PortalModerationSection enabled={canApprove} />

          {/* The results region: while a filter change loads, the cards (or the
              empty message) dim and a thin bar runs along the top, so the
              signal sits where the change will land. */}
          <div
            aria-busy={isLoading}
            className={cn(
              'relative mt-5 transition-opacity duration-150',
              isLoading && 'opacity-60'
            )}
          >
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-x-0 -top-3 h-0.5 overflow-hidden rounded-full bg-border opacity-0 transition-opacity',
                isLoading && 'opacity-100 delay-150'
              )}
            >
              <div className="feed-loading-bar h-full w-1/3 rounded-full bg-muted-foreground" />
            </div>
            {posts.length === 0 && !isPending ? (
              activeSearch ? (
                // A search that finds nothing is the moment to post the idea.
                <div className="text-center py-8 px-4 space-y-3">
                  <p className="text-muted-foreground">
                    {intl.formatMessage(
                      {
                        id: 'portal.feedback.list.noSearchResults',
                        defaultMessage: 'No ideas match “{query}”.',
                      },
                      { query: activeSearch }
                    )}
                  </p>
                  {canStartIdea && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDraft({ title: activeSearch, key: Date.now() })}
                    >
                      {intl.formatMessage({
                        id: 'portal.feedback.list.postSearchAsIdea',
                        defaultMessage: 'Post it as a new idea',
                      })}
                    </Button>
                  )}
                </div>
              ) : narrowingCount > 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  {activeView && narrowingCount === 1
                    ? intl.formatMessage(EMPTY_VIEW_MESSAGES[activeView])
                    : intl.formatMessage({
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
                {widenedSearch && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    {intl.formatMessage(WIDENED_SEARCH_MESSAGES[widenedSearch])}
                  </p>
                )}
                <div key={listKey} className="space-y-[var(--qb-feed-gap,0.75rem)]">
                  {posts.map((post, index) => (
                    <div
                      key={post.id}
                      className={cn(
                        'bg-card border border-border/40 rounded-lg shadow-sm overflow-hidden animate-in fade-in duration-200 fill-mode-backwards',
                        // Raised cards float without an edge; list cards are rows divided by rules.
                        '[[data-qb-cards=raised]_&]:border-transparent [[data-qb-cards=raised]_&]:shadow-md',
                        '[[data-qb-cards=list]_&]:rounded-none [[data-qb-cards=list]_&]:border-x-0 [[data-qb-cards=list]_&]:border-t-0 [[data-qb-cards=list]_&]:bg-transparent [[data-qb-cards=list]_&]:shadow-none'
                      )}
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
                        onTagClick={(tagId) =>
                          setFilters({ tagIds: toggleItem(activeTagIds, tagId) })
                        }
                        changelogEntry={post.changelogEntry}
                        isAuthenticated={isRealUser}
                        canVote={
                          post.board ? (boardPermissions?.[post.board.id]?.canVote ?? false) : false
                        }
                        canChangeStatus={canSetStatus}
                        onStatusChange={(statusId) => handleStatusChange(post, statusId)}
                        isUpdatingStatus={changeStatus.isPending}
                        showAvatar={false}
                        moderationState={post.moderationState}
                        canModerate={canApprove}
                        moderationBusy={approvePost.isPending || rejectPost.isPending}
                        onApprove={() => approvePost.mutate(post.id)}
                        onReject={() => rejectPost.mutate({ postId: post.id })}
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

        <FeedbackSidebar footer={poweredBy}>{filterPanel('sidebar')}</FeedbackSidebar>
      </div>
    </div>
  )
}
