import { Link } from '@tanstack/react-router'

interface ArticleLink {
  slug: string
  title: string
}

interface HelpCenterPrevNextProps {
  categorySlug: string
  prev: ArticleLink | null
  next: ArticleLink | null
}

export function HelpCenterPrevNext({ categorySlug, prev, next }: HelpCenterPrevNextProps) {
  if (!prev && !next) return null

  return (
    <div className="mt-10 pt-8 border-t border-border/40 flex items-start justify-between gap-4">
      {prev ? (
        <Link to={`/hc/articles/${categorySlug}/${prev.slug}` as '/hc'} className="group text-left">
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
        <Link
          to={`/hc/articles/${categorySlug}/${next.slug}` as '/hc'}
          className="group text-right"
        >
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
