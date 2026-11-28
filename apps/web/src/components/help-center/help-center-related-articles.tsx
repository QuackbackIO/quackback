import { Link } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { useHelpCenterMainLanguage } from '@/lib/client/hooks/use-help-center-main-language'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import { HelpCenterLanguageLabel, contentLangProps } from './help-center-category-grid'

export interface RelatedArticleLink {
  id: string
  urlId: number
  slug: string
  title: string
  description: string | null
  categorySlug: string
  /** The language the title and description are in; defaults to the page's. */
  locale?: string
}

interface HelpCenterRelatedArticlesProps {
  articles: RelatedArticleLink[]
  /** Content locale (domains/languages §2); omitted = default locale links. */
  locale?: string
}

export function HelpCenterRelatedArticles({ articles, locale }: HelpCenterRelatedArticlesProps) {
  const mainLanguage = useHelpCenterMainLanguage()
  if (articles.length === 0) return null
  const pageLocale = locale ?? mainLanguage

  // Every article has a page in the page's language: its version there, or
  // its own text with a notice.
  const hrefFor = (article: RelatedArticleLink) =>
    hcArticlePath({
      locale: pageLocale,
      urlId: article.urlId,
      slug: article.slug,
    }) as '/hc'

  return (
    <section aria-labelledby="hc-related" className="mt-10 pt-8 border-t border-border/40">
      <h2 id="hc-related" className="text-lg font-semibold tracking-tight text-foreground">
        <FormattedMessage id="portal.hc.relatedArticles.title" defaultMessage="Related articles" />
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <Link
            key={article.id}
            to={hrefFor(article)}
            className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span
                  {...contentLangProps(article.locale, pageLocale)}
                  className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary-ink"
                >
                  {article.title}
                </span>
                <HelpCenterLanguageLabel locale={article.locale} pageLocale={pageLocale} />
              </span>
              {article.description && (
                <span
                  {...contentLangProps(article.locale, pageLocale)}
                  className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground"
                >
                  {article.description}
                </span>
              )}
            </span>
            <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary-ink" />
          </Link>
        ))}
      </div>
    </section>
  )
}
