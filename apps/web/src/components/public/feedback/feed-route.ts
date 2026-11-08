// What the feed's routes share: its search, loader and head. Kept out of the
// route files, because importing a route file from another route skips code
// splitting and would pull the whole feed page into the entry chunk.
import { notFound, redirect, type ParsedLocation } from '@tanstack/react-router'
import { z } from 'zod'
import { portalDataParams } from '@/components/public/feedback/portal-data-params'
import { portalQueries } from '@/lib/client/queries/portal'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { portalDefaultSort } from '@/lib/shared/design/view'
import { portalPageGates, type PortalPathSettings } from '@/lib/shared/design/paths'
import type { RouterContext } from '@/routes/__root'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { PUBLIC_FEED_VIEWS, PUBLIC_POST_SORTS } from '@/lib/shared/types/filters'
import {
  headSettings,
  pageShareMeta,
  pageTitle,
  portalHeadWords,
  portalSiteName,
} from '@/lib/shared/portal-head'

/** The feed's search: shareable filters, kept in the URL. */
export const feedSearchSchema = z.object({
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

export type FeedSearch = z.infer<typeof feedSearchSchema>

/** Whether a search is a feed's, so the root can send an old feed link on to the feed. */
export function hasFeedSearch(search: Record<string, unknown>): boolean {
  return Object.keys(feedSearchSchema.shape).some((key) => search[key] !== undefined)
}

/** The workspace's design and pages as the portal paths read them. */
export function portalPathsOf(context: Pick<RouterContext, 'settings' | 'session'>) {
  const design = context.settings?.portalDesign
  const settings: PortalPathSettings =
    design?.engine === 'v2' ? { engine: 'v2', nav: design.nav } : { engine: 'legacy' }
  const user = context.session?.user
  const gates = portalPageGates(context.settings, !!user && user.principalType !== 'anonymous')
  return { settings, gates }
}

/**
 * When the Feedback product is off, the feed's address sends a visitor to the
 * first page the workspace has instead.
 */
export function feedFallback(org: NonNullable<RouterContext['settings']>): never {
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

/**
 * The feed's data for whichever route shows it: `/feedback`, or `/` while the
 * feed is the landing page. `canonicalPath` is the feed's one address.
 */
export async function loadFeed(
  context: RouterContext,
  location: ParsedLocation,
  canonicalPath: '/' | '/feedback'
) {
  const { session, settings: org, queryClient } = context
  if (!org) throw redirect({ to: '/onboarding' })
  if (!isProductEnabled(org.featureFlags, 'feedback')) feedFallback(org)

  // Parse search params for initial SSR (not using loaderDeps to avoid re-execution)
  const searchParams = location.search as FeedSearch

  // Fire-and-forget: kick the feed query off but DON'T await it, so the
  // document's first byte (header, hero, welcome card) flushes immediately
  // and the feed streams into the same HTML response via the router
  // ssr-query integration. The feed region renders under a Suspense boundary
  // in the component (useSuspenseQuery below). Mirrors the fire-and-forget
  // prefetch tier used for the vote sidebar on the post-detail route.
  // prefetchQuery never rejects (it swallows the queryFn error into the
  // cache), so no rejection handler is needed here.
  void queryClient.prefetchQuery(
    portalQueries.portalData(
      portalDataParams(searchParams, session?.user?.id, portalDefaultSort(org))
    )
  )

  return {
    // Only head()-critical scalars ride in loader data. The full settings copy
    // and the session already live on the root router context, so the
    // component reads them from there instead of re-serializing them into
    // the SSR HTML. `isEmpty` is derived in the component from the suspense
    // query, since the feed query is not awaited here.
    workspaceName: org.name,
    baseUrl: context.baseUrl ?? '',
    canonicalPath,
  }
}

/** The feed's title, description and canonical address. */
export function feedHead(
  loaderData: Awaited<ReturnType<typeof loadFeed>> | undefined,
  matches?: ReadonlyArray<{ context?: unknown }>
) {
  if (!loaderData) return {}
  const { baseUrl, canonicalPath } = loaderData
  const settings = headSettings(matches)
  const title = pageTitle(settings, 'feedback')
  const description = portalHeadWords(settings).feedback(portalSiteName(settings))
  const canonical = canonicalPath === '/' ? baseUrl : `${baseUrl}${canonicalPath}`
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      ...(baseUrl ? [{ property: 'og:url', content: canonical }] : []),
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      ...pageShareMeta(settings, baseUrl, 'feedback'),
    ],
    links: baseUrl ? [{ rel: 'canonical', href: canonical }] : [],
  }
}
