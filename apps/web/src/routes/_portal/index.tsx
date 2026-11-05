import { Suspense, useDeferredValue, useState } from 'react'
import { createFileRoute, notFound, redirect, useRouteContext } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ViewerPortalNoBoards } from '@/components/public/portal-no-boards'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { PortalWelcomeCard } from '@/components/public/feedback/portal-welcome-card'
import { PortalFeedSkeleton } from '@/components/public/feedback/portal-feed-skeleton'
import { PortalPoweredBy } from '@/components/public/feedback/portal-powered-by'
import {
  createFeedHandoff,
  FeedHandoffContext,
} from '@/components/public/feedback/feed-input-handoff'
import { usePreviewWelcomeCard } from '@/components/public/preview-draft-context'
import { portalQueries, useSeedPortalStatusesCache } from '@/lib/client/queries/portal'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { getShowPoweredByFn } from '@/lib/server/functions/powered-by'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { PUBLIC_FEED_VIEWS, PUBLIC_POST_SORTS } from '@/lib/shared/types/filters'

const searchSchema = z.object({
  board: z.string().optional(),
  search: z.string().optional(),
  // No schema default: the router would write it into the URL and redirect a bare
  // "/" to "/?sort=trending". An absent sort is trending wherever the feed reads it.
  sort: z.enum(PUBLIC_POST_SORTS).optional().catch('trending'),
  status: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  minVotes: z.coerce.number().int().min(1).optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => !Number.isNaN(new Date(s).getTime()), 'Invalid calendar date')
    .optional(),
  responded: z.enum(['responded', 'unresponded']).optional(),
  // Team-only filters (rendered only for post.view_private holders; the server
  // ignores them for everyone else). URL-driven + shareable like the rest.
  owner: z.string().optional(),
  segmentIds: z.array(z.string()).optional(),
  view: z.enum(PUBLIC_FEED_VIEWS).optional().catch(undefined),
})

/** Build the portalData query params from the current search + session. */
function portalDataParams(searchParams: z.infer<typeof searchSchema>, userId: string | undefined) {
  return {
    boardSlug: searchParams.board,
    search: searchParams.search,
    sort: searchParams.sort ?? ('trending' as const),
    statusSlugs: searchParams.status?.length ? searchParams.status : undefined,
    tagIds: searchParams.tagIds?.length ? searchParams.tagIds : undefined,
    userId,
    minVotes: searchParams.minVotes,
    dateFrom: searchParams.dateFrom,
    responded: searchParams.responded,
    owner: searchParams.owner,
    segmentIds: searchParams.segmentIds?.length ? searchParams.segmentIds : undefined,
    view: searchParams.view,
  }
}

export const Route = createFileRoute('/_portal/')({
  validateSearch: searchSchema,
  // Note: No loaderDeps - loader only runs on initial route load for SSR.
  // Client-side filter changes are handled by FeedbackContainer's usePublicPosts.
  // We access search params via location.search for initial SSR without triggering
  // loader re-execution on client-side filter changes.
  loader: async ({ context, location }) => {
    const { session, settings: org, queryClient } = context

    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    if (!isProductEnabled(org.featureFlags, 'feedback')) {
      if (isProductEnabled(org.featureFlags, 'support')) {
        if (isPortalSupportSurfaceEnabled(org.featureFlags, org.portalConfig)) {
          throw redirect({ to: '/support' })
        }
      }
      if (isProductEnabled(org.featureFlags, 'helpCenter')) {
        throw redirect({ to: '/hc' })
      }
      if (isProductEnabled(org.featureFlags, 'changelog')) {
        throw redirect({ to: '/changelog' })
      }
      if (isStatusPagePublished(org.featureFlags, org.statusConfig)) {
        throw redirect({ to: '/status' })
      }
      throw notFound()
    }

    // Parse search params for initial SSR (not using loaderDeps to avoid re-execution)
    const searchParams = location.search as z.infer<typeof searchSchema>

    // Fire-and-forget: kick the feed query off but DON'T await it, so the
    // document's first byte (header, hero, welcome card) flushes immediately
    // and the feed streams into the same HTML response via the router
    // ssr-query integration. The feed region renders under a Suspense boundary
    // in the component (useSuspenseQuery below). Mirrors the fire-and-forget
    // prefetch tier used for the vote sidebar on the post-detail route.
    // prefetchQuery never rejects (it swallows the queryFn error into the
    // cache), so no rejection handler is needed here.
    void queryClient.prefetchQuery(
      portalQueries.portalData(portalDataParams(searchParams, session?.user?.id))
    )

    const showPoweredBy = await getShowPoweredByFn()
    return {
      // Only head()-critical scalars ride in loader data now. The full settings
      // copy (`org`) and `session` used to be returned here too — both already
      // live on the root router context, so the component reads them from there
      // (useRouteContext) instead of re-serializing a third settings copy into
      // the SSR HTML. `isEmpty` moved into the component (derived from the
      // suspense query) since the feed query is no longer awaited here.
      workspaceName: org.name,
      baseUrl: context.baseUrl ?? '',
      showPoweredBy,
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Feedback - ${workspaceName}`
    const description = `Submit and vote on feature requests for ${workspaceName}. Help shape what gets built next.`
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(baseUrl ? [{ property: 'og:url', content: baseUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: baseUrl ? [{ rel: 'canonical', href: baseUrl }] : [],
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const { showPoweredBy } = Route.useLoaderData()
  const settings = useWorkspaceSettings()
  // Input typed while the feed loads is carried only within this visit's feed.
  const [feedHandoff] = useState(createFeedHandoff)
  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-6">
      {/* Hero renders immediately (context-only, no feed dependency). */}
      <PortalHero />
      {/* Only the feed region suspends on the streamed portalData query. */}
      <FeedHandoffContext.Provider value={feedHandoff}>
        <Suspense
          fallback={
            <PortalFeedSkeleton
              poweredBy={
                showPoweredBy ? <PortalPoweredBy workspaceSlug={settings?.slug ?? ''} /> : null
              }
            />
          }
        >
          <PortalFeed />
        </Suspense>
      </FeedHandoffContext.Provider>
    </div>
  )
}

/**
 * The welcome card. In the admin branding preview an unsaved welcome-card
 * draft wins over the saved config; read here rather than by the page, a
 * draft edit re-renders the card and not the feed beside it.
 */
function PortalHero() {
  const draftWelcomeCard = usePreviewWelcomeCard()
  const savedWelcomeCard = useRouteContext({
    from: '__root__',
    select: (context) => context.settings?.publicPortalConfig?.welcomeCard,
  })
  return <PortalWelcomeCard welcomeCard={draftWelcomeCard ?? savedWelcomeCard} />
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
  const { showPoweredBy } = Route.useLoaderData()
  const liveSearch = Route.useSearch()
  // This query only seeds the first render. Later filter changes belong to
  // the feed's own query, which keeps the page on screen while it loads;
  // keying this one on the live URL would suspend the whole feed region.
  const [search] = useState(liveSearch)

  const currentBoard = liveSearch.board
  const currentSearch = liveSearch.search
  const currentSort = liveSearch.sort ?? 'trending'

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
      portalQueries.portalData(portalDataParams(search, deferredViewerId)).queryKey
    ) !== undefined
  const viewerId =
    deferredViewerId !== liveViewerId && !previousFeedCached ? liveViewerId : deferredViewerId
  const { data: portalData } = useSuspenseQuery(
    portalQueries.portalData(portalDataParams(search, viewerId))
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
  const workspaceSlug = settings?.slug ?? ''

  // Empty state if no boards exist (derived from the query, not the loader).
  if (portalData.boards.length === 0) {
    return <ViewerPortalNoBoards orgName={workspaceName} />
  }

  return (
    <FeedbackContainer
      workspaceName={workspaceName}
      workspaceSlug={workspaceSlug}
      boards={portalData.boards}
      posts={portalData.posts.items}
      statuses={portalData.statuses}
      tags={portalData.tags}
      hasMore={portalData.posts.hasMore}
      votedPostIds={portalData.votedPostIds}
      currentBoard={currentBoard}
      currentSearch={currentSearch}
      currentSort={currentSort}
      defaultBoardId={portalData.boards[0]?.id}
      boardPermissions={portalData.boardPermissions}
      facets={portalData.facets}
      searchMode={'searchMode' in portalData.posts ? portalData.posts.searchMode : undefined}
      postsFilters={search}
      showPoweredBy={showPoweredBy}
    />
  )
}
