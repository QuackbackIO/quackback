import { lazy, Suspense, type ComponentProps } from 'react'
import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { portalLanding, previewsHome } from '@/lib/shared/design/paths'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import {
  feedHead,
  feedSearchSchema,
  hasFeedSearch,
  loadFeed,
  portalPathsOf,
  preloadPageGraph,
} from '@/components/public/feedback/feed-route'

/** The feed page, from its own chunk, as the feed route loads it. */
const FeedComponent = lazyRouteComponent(
  () => import('@/components/public/feedback/feed-page'),
  'FeedPage'
)

/** What marks the feed in the server's page (feedback-container.tsx). */
const FEED_DRAWN = '[data-qb-section="feed"]'
/** What marks Home in the server's page: its grid (portal-home.tsx). */
const HOME_DRAWN = '[data-qb-section="home"][data-qb-grid]'

/** Home's module: its page, and what its loader starts. One import serves both. */
type HomeModule = typeof import('@/components/public/home/portal-home')
/** Home's module once it is in, so Home can be drawn without waiting for it. */
let homeModule: HomeModule | undefined
const importHome = () =>
  import('@/components/public/home/portal-home').then((module) => (homeModule = module))
const LazyHome = lazy(() => importHome().then((module) => ({ default: module.PortalHome })))

/**
 * Home, drawn at once when its module is in, else as it arrives. A lazy
 * component waits once even for a module already loaded, and Home waiting
 * while the page hydrates is what let an update draw it again from nothing.
 */
function PortalHome(props: ComponentProps<HomeModule['PortalHome']>) {
  return homeModule ? <homeModule.PortalHome {...props} /> : <LazyHome {...props} />
}

// Where the server drew Home, its module starts loading with the page's own
// scripts rather than when hydration reaches it. Until it hydrates, an update
// from above (the theme, the session) makes React draw Home again from
// nothing, and on a slow phone its blocks vanished for seconds while the
// module and its reads arrived. The feed drawn here is the same.
if (typeof document !== 'undefined') {
  if (document.querySelector(HOME_DRAWN)) void importHome()
  else if (document.querySelector(FEED_DRAWN)) void FeedComponent.preload?.()
}

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
      const home = await importHome()
      const messages = await home.loadHome(
        context.queryClient,
        design?.engine === 'v2' ? design.home.blocks : [],
        gates,
        context.acceptLanguageLocale ?? DEFAULT_LOCALE,
        previewing,
        design?.engine === 'v2' && design.home.mainAction === 'search'
      )
      return {
        landing: 'home' as const,
        workspaceName: context.settings.name,
        baseUrl: context.baseUrl ?? '',
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
  head: ({ loaderData, matches }) =>
    loaderData?.landing === 'home'
      ? { links: loaderData.baseUrl ? [{ rel: 'canonical', href: loaderData.baseUrl }] : [] }
      : feedHead(loaderData, matches),
  component: PortalLanding,
})

function PortalLanding() {
  const data = Route.useLoaderData()
  if (data.landing === 'home') {
    // The feed starts its own chunk (feed-page.tsx).
    preloadPageGraph('home')
    return (
      <Suspense fallback={null}>
        <PortalHome messages={data.messages} gates={data.gates} />
      </Suspense>
    )
  }
  return <FeedComponent />
}
