import { Link } from '@tanstack/react-router'
import { DocumentTextIcon, ChevronRightIcon } from '@heroicons/react/24/outline'

export interface PopularArticle {
  id: string
  slug: string
  title: string
  categorySlug: string
  categoryName: string
}

interface HelpCenterPopularArticlesProps {
  articles: PopularArticle[]
}

export function HelpCenterPopularArticles({ articles }: HelpCenterPopularArticlesProps) {
  if (articles.length === 0) return null

  return (
    <section aria-labelledby="hc-popular" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <h2 id="hc-popular" className="mb-5 text-2xl font-semibold tracking-tight text-foreground">
        Popular articles
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {articles.map((article) => (
          <Link
            key={article.id}
            to={`/hc/articles/${article.categorySlug}/${article.slug}` as '/hc'}
            className="group flex items-center gap-4 px-6 py-5 transition-colors hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <DocumentTextIcon className="size-5 shrink-0 text-primary" />
            <span className="flex-1 text-base font-medium text-foreground">{article.title}</span>
            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
              {article.categoryName}
            </span>
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </section>
  )
}
