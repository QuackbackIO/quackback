import { Link } from '@tanstack/react-router'
import { localizedHcPath } from '@/lib/shared/help-center-url'

interface ArticleLink {
  slug: string
  title: string
}

interface HelpCenterPrevNextProps {
  categorySlug: string
  prev: ArticleLink | null
  next: ArticleLink | null
  /** Content locale (domains/languages §2); omitted = default locale links. */
  locale?: string
}

export function HelpCenterPrevNext({ categorySlug, prev, next, locale }: HelpCenterPrevNextProps) {
  if (!prev && !next) return null

  const hrefFor = (slug: string) => {
    const path = `/hc/articles/${categorySlug}/${slug}`
    return (locale ? localizedHcPath(locale, path) : path) as '/hc'
  }

  return (
    <div className="mt-10 pt-8 border-t border-border/40 flex items-start justify-between gap-4">
      {prev ? (
        <Link to={hrefFor(prev.slug)} className="group text-left">
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
        <Link to={hrefFor(next.slug)} className="group text-right">
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
