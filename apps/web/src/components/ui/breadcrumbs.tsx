import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from '@heroicons/react/16/solid'
import { cn } from '@/lib/shared/utils'

export interface BreadcrumbSegment {
  /** Label rendered for this segment. */
  label: string
  /** Optional href — when set, the segment is a Link; otherwise it's
   *  the terminal (current page) segment and renders as plain text. */
  to?: string
}

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[]
  className?: string
}

/**
 * Multi-segment breadcrumb. The last segment (typically the current
 * page) renders as text; preceding segments are links to navigate up
 * the hierarchy. Wraps gracefully on narrow viewports.
 */
export function Breadcrumbs({ segments, className }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn('flex flex-wrap items-center gap-1 text-sm text-muted-foreground', className)}
    >
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <span key={`${segment.label}-${index}`} className="inline-flex items-center gap-1">
            {segment.to && !isLast ? (
              <Link to={segment.to} className="hover:text-foreground transition-colors">
                {segment.label}
              </Link>
            ) : (
              <span className={isLast ? 'text-foreground font-medium' : undefined}>
                {segment.label}
              </span>
            )}
            {!isLast ? <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground/60" /> : null}
          </span>
        )
      })}
    </nav>
  )
}
