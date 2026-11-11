import { Suspense, useDeferredValue, useMemo, useState } from 'react'
import { useRouteContext, useSearch } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ViewerPortalNoBoards } from '@/components/public/portal-no-boards'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { PortalWelcomeCard } from '@/components/public/feedback/portal-welcome-card'
import { PortalBand } from '@/components/public/portal-band'
import { PortalFeedSkeleton } from '@/components/public/feedback/portal-feed-skeleton'
import {
  createFeedHandoff,
  FeedHandoffContext,
} from '@/components/public/feedback/feed-input-handoff'
import { usePortalDesign, usePreviewWelcomeCard } from '@/components/public/preview-draft-context'
import { portalQueries, useSeedPortalStatusesCache } from '@/lib/client/queries/portal'
import type { PortalWelcomeCard as PortalWelcomeCardData } from '@/lib/shared/types/settings'
import { portalDefaultSort, savedWelcomeCard } from '@/lib/shared/design/view'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { preloadPageGraph, type FeedSearch } from '@/components/public/feedback/feed-route'
import { portalDataParams, postsFetchedFor } from '@/components/public/feedback/portal-data-params'

/** The feed's search, wherever the feed shows. */
const useFeedSearch = () => useSearch({ strict: false }) as FeedSearch

/** The feed page: the band, the welcome card and the feed. */
export function FeedPage() {
  preloadPageGraph('feed')
  const settings = useWorkspaceSettings()
  // Input typed while the feed loads is carried only within this visit's feed.
  const [feedHandoff] = useState(createFeedHandoff)
  return (
    <>
      <PortalBand />
      <div className="qb-page py-6">
        {/* Hero renders immediately (context-only, no feed dependency). */}
        <PortalHero />
        {/* Only the feed region suspends on the streamed portalData query. */}
        <FeedHandoffContext.Provider value={feedHandoff}>
          <Suspense fallback={<PortalFeedSkeleton defaultSort={portalDefaultSort(settings)} />}>
            <PortalFeed />
          </Suspense>
        </FeedHandoffContext.Provider>
      </div>
    </>
  )
}

/**
 * The welcome card. On the design engine it is the design's, the draft's in
 * the builder, as every part is. Otherwise, in the admin branding preview, an
 * unsaved welcome-card draft wins over the saved config. Read here rather
 * than by the page, a draft edit re-renders the card and not the feed beside it.
 */
function PortalHero() {
  const draftWelcomeCard = usePreviewWelcomeCard()
  const legacyWelcomeCard = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.publicPortalConfig?.welcomeCard,
  })
  // On the design engine the welcome message is part of the design.
  const design = usePortalDesign()
  // An unsaved settings draft stands in for the saved settings card, never for the design's.
  const card = useMemo(
    () => savedWelcomeCard(design, draftWelcomeCard ?? legacyWelcomeCard),
    [design, draftWelcomeCard, legacyWelcomeCard]
  )
  return <PortalWelcomeCard welcomeCard={card as PortalWelcomeCardData | undefined} />
}

/**
 * Feed region — suspends on the streamed portalData query. The loader fires the
 * query without awaiting; the router ssr-query integration streams its result
 * into the same HTML response, so the feed is still server-rendered (SEO
 * preserved) while the header/hero above flush on the first byte.
 */
function PortalFeed() {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const liveSearch = useFeedSearch()
  // This query only seeds the first render. Later filter changes belong to
  // the feed's own query, which keeps the page on screen while it loads;
  // keying this one on the live URL would suspend the whole feed region.
  const [search] = useState(liveSearch)

  const currentBoard = liveSearch.board
  const currentSearch = liveSearch.search
  const defaultSort = portalDefaultSort(settings)
  const currentSort = liveSearch.sort ?? defaultSort

  // A visitor's first post or vote mints an anonymous session mid-action,
  // which changes the viewer and so the feed's key. Deferring the viewer
  // keeps the current feed, and the composer inside it, on screen while the
  // new viewer's feed loads, instead of swapping them for the skeleton.
  // Signing in or out clears every viewer's feed first, so there is nothing
  // to keep on screen: key on the new viewer straight away, rather than
  // fetching the old viewer's feed again under the new session.
  const queryClient = useQueryClient()
  const liveViewerId = session?.user?.id
  const deferredViewerId = useDeferredValue(liveViewerId)
  const previousFeedCached =
    queryClient.getQueryData(
      portalQueries.portalData(portalDataParams(search, deferredViewerId, defaultSort)).queryKey
    ) !== undefined
  const viewerId =
    deferredViewerId !== liveViewerId && !previousFeedCached ? liveViewerId : deferredViewerId
  const { data: portalData } = useSuspenseQuery(
    portalQueries.portalData(portalDataParams(search, viewerId, defaultSort))
  )

  // Seeds the shared statuses cache from this response so a post-detail
  // navigation right after reuses it instead of fetching the same status
  // list again (see useSeedPortalStatusesCache).
  useSeedPortalStatusesCache(portalData.statuses)

  // votedPosts is seeded from portalData.votedPostIds via FeedbackContainer's
  // useVotedPosts({ initialVotedIds }) below (its query uses that as
  // initialData), so vote highlights are present in the server-rendered HTML
  // without a separate loader-side setQueryData.
  const workspaceName = settings?.name ?? 'Quackback'

  // Empty state if no boards exist (derived from the query, not the loader).
  if (portalData.boards.length === 0) {
    return <ViewerPortalNoBoards orgName={workspaceName} />
  }

  return (
    <FeedbackContainer
      workspaceName={workspaceName}
      boards={portalData.boards}
      posts={portalData.posts.items}
      statuses={portalData.statuses}
      tags={portalData.tags}
      hasMore={portalData.posts.hasMore}
      votedPostIds={portalData.votedPostIds}
      currentBoard={currentBoard}
      currentSearch={currentSearch}
      currentSort={currentSort}
      defaultSort={defaultSort}
      defaultBoardId={portalData.boards[0]?.id}
      boardPermissions={portalData.boardPermissions}
      facets={portalData.facets}
      searchMode={'searchMode' in portalData.posts ? portalData.posts.searchMode : undefined}
      postsFilters={postsFetchedFor(search, defaultSort)}
    />
  )
}
