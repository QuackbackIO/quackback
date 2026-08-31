import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath } from '@/lib/shared/help-center-url'

export interface RelatedArticleLink {
  id: string
  urlId: number
  slug: string
  title: string
  description: string | null
  categorySlug: string
}

interface HelpCenterRelatedArticlesProps {
  articles: RelatedArticleLink[]
  /** Content locale (domains/languages §2); omitted = default locale links. */
  locale?: string
}

export function HelpCenterRelatedArticles({ articles, locale }: HelpCenterRelatedArticlesProps) {
  if (articles.length === 0) return null

  const hrefFor = (article: RelatedArticleLink) =>
    hcArticlePath({
      locale: locale ?? DEFAULT_LOCALE,
      urlId: article.urlId,
      slug: article.slug,
    }) as '/hc'

  return (
    <section aria-labelledby="hc-related" className="mt-10 pt-8 border-t border-border/40">
      <h2 id="hc-related" className="text-lg font-semibold tracking-tight text-foreground">
        Related articles
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <Link
            key={article.id}
            to={hrefFor(article)}
            className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                {article.title}
              </span>
              {article.description && (
                <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                  {article.description}
                </span>
              )}
            </span>
            <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </section>
  )
}
