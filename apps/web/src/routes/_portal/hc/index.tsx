import { createFileRoute, redirect } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { HelpCenterPopularArticles } from '@/components/help-center/help-center-popular-articles'
import { getTopLevelCategories } from '@/components/help-center/help-center-utils'
import {
  listPublicCategoriesFn,
  listPopularPublicArticlesFn,
} from '@/lib/server/functions/help-center'
import { resolveHcLandingLocale } from '@/lib/shared/help-center-url'
import { HC_LOCALE_COOKIE } from '@/components/help-center/help-center-locale-switcher'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

const DEFAULT_TITLE = 'How can we help?'
const DEFAULT_DESCRIPTION =
  'Search our guides or ask AI for an instant answer. Real answers, fast, no ticket required.'

/**
 * SSR-only request context for browser-locale detection. The isomorphic split
 * keeps the server-only header import out of the client bundle
 * (import-protection denies it there); a client-side nav that already landed
 * here has nothing to detect.
 */
const landingRequestContext = createIsomorphicFn()
  .client((): { cookieHeader: string; acceptLanguage: string | null } | null => null)
  .server((): { cookieHeader: string; acceptLanguage: string | null } | null => {
    try {
      const headers = getRequestHeaders()
      return {
        cookieHeader: headers.get('cookie') ?? '',
        acceptLanguage: headers.get('accept-language'),
      }
    } catch {
      return null
    }
  })

/** Only meaningful during SSR (browser-detect needs the real request headers/cookies). */
function landingLocaleRedirectTarget(helpCenterConfig?: HelpCenterConfig): string | null {
  const additional = helpCenterConfig?.locales?.additional ?? []
  if (additional.length === 0) return null
  const req = landingRequestContext()
  if (!req) return null
  const cookieMatch = new RegExp(`${HC_LOCALE_COOKIE}=([^;]+)`).exec(req.cookieHeader)
  return resolveHcLandingLocale({
    cookieLocale: cookieMatch?.[1] ?? null,
    acceptLanguage: req.acceptLanguage,
    enabledAdditionalLocales: additional,
    defaultLocale: helpCenterConfig?.locales?.default ?? 'en',
  })
}

export const Route = createFileRoute('/_portal/hc/')({
  beforeLoad: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const target = landingLocaleRedirectTarget(helpCenterConfig)
    if (target) throw redirect({ to: `/hc/${target}` as '/', replace: true })
  },
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const [categories, popularArticles] = await Promise.all([
      listPublicCategoriesFn({ data: {} }),
      listPopularPublicArticlesFn({ data: { limit: 6 } }),
    ])

    return {
      categories,
      popularArticles,
      helpCenterConfig: helpCenterConfig ?? null,
      workspaceName: settings?.name ?? 'Help Center',
      logoUrl: settings?.brandingData?.logoUrl || '/logo.png',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}

    const { helpCenterConfig, workspaceName, logoUrl } = loaderData
    const title = helpCenterConfig?.homepageTitle ?? DEFAULT_TITLE
    const description = helpCenterConfig?.homepageDescription ?? DEFAULT_DESCRIPTION

    const pageTitle = `${title} - ${workspaceName}`

    return {
      meta: [
        { title: pageTitle },
        { name: 'description', content: description },
        { property: 'og:title', content: pageTitle },
        { property: 'og:description', content: description },
        { property: 'og:image', content: logoUrl },
        { name: 'twitter:title', content: pageTitle },
        { name: 'twitter:description', content: description },
      ],
    }
  },
  component: HelpCenterLandingPage,
})

function HelpCenterLandingPage() {
  const { categories, popularArticles, helpCenterConfig } = Route.useLoaderData()
  const { settings } = Route.useRouteContext()
  const askAiEnabled = !!settings?.featureFlags?.helpCenterAiAnswers

  const title = helpCenterConfig?.homepageTitle ?? DEFAULT_TITLE
  const description = helpCenterConfig?.homepageDescription ?? DEFAULT_DESCRIPTION
  const collectionCount = getTopLevelCategories(categories).length

  return (
    <>
      <HelpCenterHero variant="home" title={title} description={description}>
        <HelpCenterHeroSearch askAiEnabled={askAiEnabled} />
      </HelpCenterHero>

      <section
        aria-labelledby="hc-topics"
        className="mx-auto max-w-6xl px-4 pb-16 pt-2 sm:px-6 animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 id="hc-topics" className="text-2xl font-semibold tracking-tight text-foreground">
            Browse by topic
          </h2>
          {collectionCount > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {collectionCount} {collectionCount === 1 ? 'collection' : 'collections'}
            </span>
          )}
        </div>
        <HelpCenterCategoryGrid categories={categories} />
      </section>

      <HelpCenterPopularArticles articles={popularArticles} />
    </>
  )
}
