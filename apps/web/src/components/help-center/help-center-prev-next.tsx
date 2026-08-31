import { Link } from '@tanstack/react-router'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath } from '@/lib/shared/help-center-url'

interface ArticleLink {
  id: string
  urlId: number
  slug: string
  title: string
}

interface HelpCenterPrevNextProps {
  prev: ArticleLink | null
  next: ArticleLink | null
  locale?: string
}

export function HelpCenterPrevNext({ prev, next, locale }: HelpCenterPrevNextProps) {
  if (!prev && !next) return null
  const loc = locale ?? DEFAULT_LOCALE

  const hrefFor = (article: ArticleLink) =>
    hcArticlePath({ locale: loc, urlId: article.urlId, slug: article.slug }) as '/hc'

  return (
    <div className="mt-10 pt-8 border-t border-border/40 flex items-start justify-between gap-4">
      {prev ? (
        <Link to={hrefFor(prev)} className="group text-left">
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            &larr; Previous
          </span>
          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors mt-0.5">
            {prev.title}
          </p>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link to={hrefFor(next)} className="group text-right">
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            Next &rarr;
          </span>
          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors mt-0.5">
            {next.title}
          </p>
        </Link>
      ) : (
        <div />
      )}
    </div>
  )
}
