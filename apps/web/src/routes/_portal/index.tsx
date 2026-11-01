import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { portalLanding, previewsHome } from '@/lib/shared/design/paths'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { getShowPoweredByFn } from '@/lib/server/functions/powered-by'
import {
  feedHead,
  feedSearchSchema,
  hasFeedSearch,
  loadFeed,
  portalPathsOf,
  Route as FeedbackRoute,
} from './feedback'

/** Home's module: its page, and what its loader starts. One import serves both. */
const importHome = () => import('@/components/public/home/portal-home')
const PortalHome = lazy(() => importHome().then((module) => ({ default: module.PortalHome })))

/** The feed route's own component, loaded from its chunk. */
const FeedComponent = FeedbackRoute.options.component as NonNullable<
  typeof FeedbackRoute.options.component
> & { preload?: () => Promise<void> }

/**
 * The portal's root. With Home on it is Home, and an old link to the feed
 * here follows the feed to `/feedback`. With Home off it is the first page
 * the menu shows: the feed itself when that is Feedback, else a redirect.
 */
export const Route = createFileRoute('/_portal/')({
  // `page=home` is the Appearance preview asking for Home.
  validateSearch: feedSearchSchema.extend({ page: z.literal('home').optional().catch(undefined) }),
  // The landing only chooses what to show, so it stays in the route module:
  // the page then loads one chunk, the feed's or Home's, as it did before.
  codeSplitGroupings: [['errorComponent'], ['notFoundComponent']],
  loader: async ({ context, location }) => {
    if (!context.settings) throw redirect({ to: '/onboarding' })
    const { settings, gates } = portalPathsOf(context)
    const previewing = previewsHome(location.search)
    const landing = portalLanding(settings, gates, location.search)
    // The menu can change, so the first page is not a permanent address.
    if (landing.kind === 'redirect') throw redirect({ href: landing.to, statusCode: 302 })
    if (landing.kind === 'home') {
      if (!previewing && hasFeedSearch(location.search))
        throw redirect({ to: '/feedback', search: location.search, statusCode: 301 })
      const design = context.settings.portalDesign
      const [home, showPoweredBy] = await Promise.all([importHome(), getShowPoweredByFn()])
      const messages = await home.loadHome(
        context.queryClient,
        design?.engine === 'v2' ? design.home.blocks : [],
        gates,
        context.acceptLanguageLocale ?? DEFAULT_LOCALE,
        previewing
      )
      return {
        landing: 'home' as const,
        workspaceName: context.settings.name,
        baseUrl: context.baseUrl ?? '',
        showPoweredBy,
        gates,
        messages,
      }
    }
    const [feed] = await Promise.all([
      loadFeed(context, location, '/'),
      // Rendered here, not by its own route, so its chunk is loaded here.
      FeedComponent.preload?.(),
    ])
    return { landing: 'feed' as const, ...feed }
  },
  // Home's title, description and share tags are the portal's own, from its layout.
  head: ({ loaderData }) =>
    loaderData?.landing === 'home'
      ? { links: loaderData.baseUrl ? [{ rel: 'canonical', href: loaderData.baseUrl }] : [] }
      : feedHead(loaderData),
  component: PortalLanding,
})

function PortalLanding() {
  const data = Route.useLoaderData()
  if (data.landing === 'home')
    return (
      <Suspense fallback={null}>
        <PortalHome messages={data.messages} gates={data.gates} />
      </Suspense>
    )
  return <FeedComponent />
}
