import { FormattedMessage, useIntl } from 'react-intl'
import { HelpCenterHero } from './help-center-hero'
import { HelpCenterHeroSearch } from './help-center-search'
import { HelpCenterCategoryGrid } from './help-center-category-grid'
import { HelpCenterPopularArticles, type PopularArticle } from './help-center-popular-articles'
import { getTopLevelCategories } from './help-center-utils'
import { usePageChoices } from '@/components/public/use-page-choices'
import { useDesignTitles } from '@/components/public/portal-page-title'
import { topicsSectionClass } from './help-center-sections'
import { DEFAULT_HELP_CENTER_CONFIG, type HelpCenterConfig } from '@/lib/shared/types/settings'

type Copy = { id: string; defaultMessage: string }

/**
 * The landing title and description: an admin's own wording, or the defaults
 * in the page's language. Settings store the English defaults until an admin
 * edits them, so a stored default is worded like a missing one. `word` turns a
 * message into the page's language (react-intl in the page, the help center's
 * loaded strings in `head`).
 */
export function landingCopy(
  config: HelpCenterConfig | null | undefined,
  word: (copy: Copy) => string
) {
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
 * The help center's landing page as a visitor sees it, drawn from its topics
 * and popular articles: the live ones, or the designer's sample.
 */
export function HelpCenterLandingView({
  categories,
  popularArticles,
  helpCenterConfig,
  askAiEnabled,
}: {
  categories: Parameters<typeof HelpCenterCategoryGrid>[0]['categories']
  popularArticles: PopularArticle[]
  helpCenterConfig: HelpCenterConfig | null | undefined
  askAiEnabled: boolean
}) {
  const intl = useIntl()
  const { title, description } = landingCopy(helpCenterConfig, (copy) => intl.formatMessage(copy))
  const collectionCount = getTopLevelCategories(categories).length
  const choices = usePageChoices().help
  const designTitles = useDesignTitles()

  return (
    <>
      <HelpCenterHero
        variant="home"
        title={title}
        description={description}
        search={choices.search}
      >
        <HelpCenterHeroSearch
          askAiEnabled={askAiEnabled}
          size={choices.search === 'large' ? 'large' : 'hero'}
        />
      </HelpCenterHero>

      <section
        aria-labelledby="hc-topics"
        data-qb-section="topics"
        className={topicsSectionClass(designTitles, choices.topics)}
        style={{ animationDelay: '100ms' }}
      >
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2
            id="hc-topics"
            data-qb-part="section-heading"
            className="text-2xl font-semibold tracking-tight text-foreground"
          >
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
        <HelpCenterCategoryGrid categories={categories} layout={choices.topics} />
      </section>

      {choices.popular && <HelpCenterPopularArticles articles={popularArticles} />}
    </>
  )
}
