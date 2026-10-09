import { createFileRoute } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import {
  getTopLevelCategories,
  helpCenterHeadMessages,
} from '@/components/help-center/help-center-utils'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import { DEFAULT_HELP_CENTER_CONFIG, type HelpCenterConfig } from '@/lib/shared/types/settings'
import { resolvePortalOgImageUrl } from '@/lib/shared/portal-og-image'

type Copy = { id: string; defaultMessage: string }

/**
 * The landing title and description for a language: its own wording, or the
 * defaults in the page's language. Enabling a language stores the English
 * default title, so a stored default is worded like a missing one. `word` turns
 * a message into the page's language (react-intl in the page, the help
 * center's loaded strings in `head`).
 */
function landingCopy(
  chromeTitle: string | null,
  chromeDescription: string | null,
  word: (copy: Copy) => string
) {
  const title =
    chromeTitle && chromeTitle !== DEFAULT_HELP_CENTER_CONFIG.homepageTitle
      ? chromeTitle
      : word({ id: 'portal.hc.home.title', defaultMessage: 'How can we help?' })
  const description =
    chromeDescription && chromeDescription !== DEFAULT_HELP_CENTER_CONFIG.homepageDescription
      ? chromeDescription
      : word({
          id: 'portal.hc.home.localeDescription',
          defaultMessage: 'Search our knowledge base or browse by category',
        })
  return { title, description }
}

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
      // Unset chrome falls back to the default copy in the app's language,
      // on the page and in its metadata.
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
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}
    const { workspaceName, logoUrl } = loaderData
    const messages = helpCenterHeadMessages(matches)
    const { title, description } = landingCopy(
      loaderData.title,
      loaderData.description,
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
  const { title, description } = landingCopy(chromeTitle, chromeDescription, (copy) =>
    intl.formatMessage(copy)
  )

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
