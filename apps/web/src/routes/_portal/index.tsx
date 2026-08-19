import { Suspense } from 'react'
import { createFileRoute, notFound, redirect, useRouteContext } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useIntl } from 'react-intl'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { PortalWelcomeCard } from '@/components/public/feedback/portal-welcome-card'
import { usePreviewDraft } from '@/components/public/preview-draft-context'
import { portalQueries } from '@/lib/client/queries/portal'
import { isProductEnabled } from '@/lib/shared/types/settings'

const searchSchema = z.object({
  board: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('trending'),
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
        const supportPublished =
          org.featureFlags.supportTickets ||
          (org.featureFlags.supportInbox && org.portalConfig.support?.enabled === true)
        if (supportPublished) throw redirect({ to: '/support' })
      }
      if (isProductEnabled(org.featureFlags, 'helpCenter') && org.helpCenterConfig.enabled) {
        throw redirect({ to: '/hc' })
      }
      if (isProductEnabled(org.featureFlags, 'changelog')) {
        throw redirect({ to: '/changelog' })
      }
      if (isProductEnabled(org.featureFlags, 'status') && org.statusConfig.enabled) {
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

    return {
      // Only head()-critical scalars ride in loader data now. The full settings
      // copy (`org`) and `session` used to be returned here too — both already
      // live on the root router context, so the component reads them from there
      // (useRouteContext) instead of re-serializing a third settings copy into
      // the SSR HTML. `isEmpty` moved into the component (derived from the
      // suspense query) since the feed query is no longer awaited here.
      workspaceName: org.name,
      baseUrl: context.baseUrl ?? '',
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
  const { settings } = useRouteContext({ from: '__root__' })
  // Admin branding preview: unsaved welcome-card drafts win over the saved
  // config. Null outside the preview iframe.
  const previewDraft = usePreviewDraft()
  const welcomeCard = previewDraft?.welcomeCard ?? settings?.publicPortalConfig?.welcomeCard

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-6">
      {/* Hero renders immediately (context-only, no feed dependency). */}
      <PortalWelcomeCard welcomeCard={welcomeCard} />
      {/* Only the feed region suspends on the streamed portalData query. */}
      <Suspense fallback={<PortalFeedSkeleton />}>
        <PortalFeed />
      </Suspense>
    </div>
  )
}

/**
 * Feed region — suspends on the streamed portalData query. The loader fires the
 * query without awaiting; the router ssr-query integration streams its result
 * into the same HTML response, so the feed is still server-rendered (SEO
 * preserved) while the header/hero above flush on the first byte.
 */
function PortalFeed() {
  const intl = useIntl()
  const { session, settings } = useRouteContext({ from: '__root__' })
  const search = Route.useSearch()

  const currentBoard = search.board
  const currentSearch = search.search
  const currentSort = search.sort ?? 'trending'

  const { data: portalData } = useSuspenseQuery(
    portalQueries.portalData(portalDataParams(search, session?.user?.id))
  )

  // votedPosts is seeded from portalData.votedPostIds via FeedbackContainer's
  // useVotedPosts({ initialVotedIds }) below (its query uses that as
  // initialData), so vote highlights are present in the server-rendered HTML
  // without a separate loader-side setQueryData.
  const workspaceName = settings?.name ?? 'Quackback'
  const workspaceSlug = settings?.slug ?? ''

  // Empty state if no boards exist (derived from the query, not the loader).
  if (portalData.boards.length === 0) {
    return (
      <EmptyState
        icon={ChatBubbleOvalLeftEllipsisIcon}
        title={intl.formatMessage({
          id: 'portal.feedback.empty.comingSoonTitle',
          defaultMessage: 'Coming Soon',
        })}
        description={intl.formatMessage(
          {
            id: 'portal.feedback.empty.comingSoonDescription',
            defaultMessage:
              '{orgName} is setting up their feedback portal. Check back soon to share your ideas and suggestions.',
          },
          { orgName: workspaceName }
        )}
        className="py-24"
      />
    )
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
    />
  )
}

/**
 * Feed placeholder shown while the streamed portalData query resolves. Matches
 * the feed's list rhythm (toolbar band + a few PostCard-height rows) so the
 * layout doesn't jump when the real feed swaps in.
 */
function PortalFeedSkeleton() {
  return (
    <div className="py-6" aria-hidden="true">
      <div className="flex gap-8">
        <div className="flex-1 min-w-0 space-y-3">
          <div className="h-10 rounded-lg bg-muted/60 animate-pulse" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-24 rounded-lg border border-border/40 bg-muted/40 animate-pulse"
              />
            ))}
          </div>
        </div>
        <div className="hidden lg:block w-64 shrink-0 space-y-3">
          <div className="h-32 rounded-lg bg-muted/40 animate-pulse" />
        </div>
      </div>
    </div>
  )
}
