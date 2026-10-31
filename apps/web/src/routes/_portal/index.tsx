import { lazy, Suspense } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasFeedSearch, portalLanding } from '@/lib/shared/design/paths'
import { DEFAULT_LOCALE, loadAreaMessages, type MessageArea } from '@/lib/shared/i18n'
import { getShowPoweredByFn } from '@/lib/server/functions/powered-by'
import {
  feedHead,
  feedSearchSchema,
  loadFeed,
  portalPathsOf,
  Route as FeedbackRoute,
} from './feedback'

const PortalHome = lazy(() =>
  import('@/components/public/home/portal-home').then((module) => ({ default: module.PortalHome }))
)

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
  validateSearch: feedSearchSchema,
  // The landing only chooses what to show, so it stays in the route module:
  // the page then loads one chunk, the feed's or Home's, as it did before.
  codeSplitGroupings: [['errorComponent'], ['notFoundComponent']],
  loader: async ({ context, location }) => {
    if (!context.settings) throw redirect({ to: '/onboarding' })
    const { settings, gates } = portalPathsOf(context)
    const landing = portalLanding(settings, gates)
    // The menu can change, so the first page is not a permanent address.
    if (landing.kind === 'redirect') throw redirect({ href: landing.to, statusCode: 302 })
    if (landing.kind === 'home') {
      if (hasFeedSearch(location.search))
        throw redirect({ to: '/feedback', search: location.search, statusCode: 301 })
      const design = context.settings.portalDesign
      const blocks = design?.engine === 'v2' ? design.home.blocks : []
      if (design?.engine === 'v2') {
        const { prefetchHome } = await import('@/components/public/home/home-prefetch')
        prefetchHome(context.queryClient, blocks, gates, {
          sort: design.feedback.defaultSort,
          userId: context.session?.user?.id,
        })
      }
      // The help and status blocks speak their own pages' strings, which stay
      // out of the catalog every page seeds.
      const areas = [
        blocks.some((block) => block.type === 'help_search' || block.type === 'help_topics') &&
          ('helpCenter' as const),
        blocks.some((block) => block.type === 'status') && ('statusPage' as const),
      ].filter((area): area is MessageArea & ('helpCenter' | 'statusPage') => !!area)
      const locale = context.acceptLanguageLocale ?? DEFAULT_LOCALE
      const [showPoweredBy, ...areaMessages] = await Promise.all([
        getShowPoweredByFn(),
        ...areas.map((area) => loadAreaMessages(locale, area)),
      ])
      return {
        landing: 'home' as const,
        workspaceName: context.settings.name,
        baseUrl: context.baseUrl ?? '',
        showPoweredBy,
        messages: Object.fromEntries(
          areas.map((area, index) => [area, areaMessages[index]])
        ) as Partial<Record<'helpCenter' | 'statusPage', Record<string, string>>>,
      }
    }
    const [feed] = await Promise.all([
      loadFeed(context, location, '/'),
      // Rendered here, not by its own route, so its chunk is loaded here.
      FeedComponent.preload?.(),
    ])
    return { landing: 'feed' as const, ...feed }
  },
  head: ({ loaderData }) => {
    if (loaderData?.landing !== 'home') return feedHead(loaderData)
    const { workspaceName, baseUrl } = loaderData
    const description = `Share ideas, follow what is coming and find help from ${workspaceName}.`
    return {
      meta: [
        { title: workspaceName },
        { name: 'description', content: description },
        { property: 'og:title', content: workspaceName },
        { property: 'og:description', content: description },
        ...(baseUrl ? [{ property: 'og:url', content: baseUrl }] : []),
      ],
      links: baseUrl ? [{ rel: 'canonical', href: baseUrl }] : [],
    }
  },
  component: PortalLanding,
})

function PortalLanding() {
  const data = Route.useLoaderData()
  if (data.landing === 'home')
    return (
      <Suspense fallback={null}>
        <PortalHome messages={data.messages} />
      </Suspense>
    )
  return <FeedComponent />
}
