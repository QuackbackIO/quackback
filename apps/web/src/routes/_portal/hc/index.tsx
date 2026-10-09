import { createFileRoute, redirect } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { HelpCenterPopularArticles } from '@/components/help-center/help-center-popular-articles'
import {
  getTopLevelCategories,
  helpCenterHeadMessages,
} from '@/components/help-center/help-center-utils'
import {
  listPublicCategoriesFn,
  listPopularPublicArticlesFn,
} from '@/lib/server/functions/help-center'
import { HC_LOCALE_COOKIE, resolveHcLandingLocale } from '@/lib/shared/help-center-url'
import { DEFAULT_HELP_CENTER_CONFIG, type HelpCenterConfig } from '@/lib/shared/types/settings'
import { resolvePortalOgImageUrl } from '@/lib/shared/portal-og-image'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

type Copy = { id: string; defaultMessage: string }

/**
 * The landing title and description: an admin's own wording, or the defaults
 * in the page's language. Settings store the English defaults until an admin
 * edits them, so a stored default is worded like a missing one. `word` turns a
 * message into the page's language (react-intl in the page, the help center's
 * loaded strings in `head`).
 */
function landingCopy(config: HelpCenterConfig | null | undefined, word: (copy: Copy) => string) {
  const storedTitle = config?.homepageTitle
  const title =
    storedTitle == null || storedTitle === DEFAULT_HELP_CENTER_CONFIG.homepageTitle
      ? word({ id: 'portal.hc.home.title', defaultMessage: 'How can we help?' })
      : storedTitle
  const storedDescription = config?.homepageDescription
  const description =
    storedDescription == null
      ? word({
          id: 'portal.hc.home.description',
          defaultMessage:
            'Search our guides or ask AI for an instant answer. Real answers, fast, no ticket required.',
        })
      : storedDescription === DEFAULT_HELP_CENTER_CONFIG.homepageDescription
        ? word({
            id: 'portal.hc.home.localeDescription',
            defaultMessage: 'Search our knowledge base or browse by category',
          })
        : storedDescription
  return { title, description }
}

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
      logoUrl: resolvePortalOgImageUrl(
        { logoUrl: settings?.brandingData?.logoUrl },
        context.baseUrl
      ),
    }
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}

    const { helpCenterConfig, workspaceName, logoUrl } = loaderData
    const messages = helpCenterHeadMessages(matches)
    const { title, description } = landingCopy(
      helpCenterConfig,
      (copy) => messages[copy.id] ?? copy.defaultMessage
    )

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
  const intl = useIntl()
  const { categories, popularArticles, helpCenterConfig } = Route.useLoaderData()
  const settings = useWorkspaceSettings()
  const askAiEnabled = !!settings?.featureFlags?.helpCenter

  const { title, description } = landingCopy(helpCenterConfig, (copy) => intl.formatMessage(copy))
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
            <FormattedMessage id="portal.hc.home.browseByTopic" defaultMessage="Browse by topic" />
          </h2>
          {collectionCount > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground">
              <FormattedMessage
                id="portal.hc.home.collectionCount"
                defaultMessage="{count, plural, one {# collection} other {# collections}}"
                values={{ count: collectionCount }}
              />
            </span>
          )}
        </div>
        <HelpCenterCategoryGrid categories={categories} />
      </section>

      <HelpCenterPopularArticles articles={popularArticles} />
    </>
  )
}
