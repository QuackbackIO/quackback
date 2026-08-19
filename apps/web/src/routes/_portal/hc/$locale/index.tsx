import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterHero } from '@/components/help-center/help-center-hero'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { getTopLevelCategories } from '@/components/help-center/help-center-utils'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'

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
      title: chrome?.homepageTitle || DEFAULT_TITLE,
      description: chrome?.homepageDescription || DEFAULT_DESCRIPTION,
      searchPlaceholder: chrome?.searchPlaceholder || undefined,
      workspaceName: settings?.name ?? 'Help Center',
      logoUrl: settings?.brandingData?.logoUrl || '/logo.png',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { title, description, workspaceName, logoUrl } = loaderData
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
  const { categories, title, description } = Route.useLoaderData()
  const { locale } = Route.useParams()
  const collectionCount = getTopLevelCategories(categories).length

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
            Browse by topic
          </h2>
          {collectionCount > 0 && (
            <span className="shrink-0 text-sm text-muted-foreground">
              {collectionCount} {collectionCount === 1 ? 'collection' : 'collections'}
            </span>
          )}
        </div>
        <HelpCenterCategoryGrid categories={categories} locale={locale} />
      </section>
    </>
  )
}
