import { createFileRoute } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { getTopLevelCategories } from '@/components/help-center/help-center-utils'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { resolvePortalOgImageUrl } from '@/lib/shared/portal-og-image'

const DEFAULT_TITLE = 'How can we help?'
const DEFAULT_DESCRIPTION = 'Search our knowledge base or browse by category'

/**
 * Locale-prefixed help-center homepage (domains/languages §2). Mirrors
 * `/hc/index.tsx` for an additional locale: translated chrome strings,
 * translated+gated category grid. "Popular articles" is intentionally
 * omitted here -- view-count ranking has no per-locale notion yet, and
 * showing default-locale titles on a translated homepage would be
 * confusing. Ask AI is also off here (retrieval isn't locale-aware).
 */
export const Route = createFileRoute('/_portal/hc/$locale/')({
  loader: async ({ context, params }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const categories = await listPublicCategoriesFn({ data: { locale: params.locale } })
    const chrome = helpCenterConfig?.locales?.chrome?.[params.locale]

    return {
      categories,
      // Unset chrome falls back to the default copy: English in the page
      // metadata below, the app's language on the page itself.
      title: chrome?.homepageTitle || null,
      description: chrome?.homepageDescription || null,
      searchPlaceholder: chrome?.searchPlaceholder || undefined,
      workspaceName: settings?.name ?? 'Help Center',
      logoUrl: resolvePortalOgImageUrl(
        { logoUrl: settings?.brandingData?.logoUrl },
        context.baseUrl
      ),
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, logoUrl } = loaderData
    const title = loaderData.title ?? DEFAULT_TITLE
    const description = loaderData.description ?? DEFAULT_DESCRIPTION
    const pageTitle = `${title} - ${workspaceName}`
    return {
      meta: [
        { title: pageTitle },
        { name: 'description', content: description },
        { property: 'og:title', content: pageTitle },
        { property: 'og:description', content: description },
        { property: 'og:image', content: logoUrl },
      ],
    }
  },
  component: LocaleHelpCenterLandingPage,
})

function LocaleHelpCenterLandingPage() {
  const intl = useIntl()
  const { categories, title: chromeTitle, description: chromeDescription } = Route.useLoaderData()
  const { locale } = Route.useParams()
  const collectionCount = getTopLevelCategories(categories).length
  const title =
    chromeTitle ??
    intl.formatMessage({ id: 'portal.hc.home.title', defaultMessage: 'How can we help?' })
  const description =
    chromeDescription ??
    intl.formatMessage({
      id: 'portal.hc.home.localeDescription',
      defaultMessage: 'Search our knowledge base or browse by category',
    })

  return (
    <>
      <HelpCenterHero variant="home" title={title} description={description}>
        <HelpCenterHeroSearch locale={locale} />
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
        <HelpCenterCategoryGrid categories={categories} locale={locale} />
      </section>
    </>
  )
}
