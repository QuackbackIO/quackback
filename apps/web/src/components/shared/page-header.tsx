import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'

/** A parent of the current page. Without `to` it is a module name with no page of its own. */
export interface PageCrumb {
  label: string
  to?: string
  params?: Record<string, string>
  search?: Record<string, unknown>
}

interface PageHeaderProps {
  title: string
  /** The heading level. A side pane's title heads the pane, not the page, so panes pass `h2`. */
  as?: 'h1' | 'h2'
  description?: string
  /** A quiet badge beside the title, for a non-default state of the page's subject. */
  badge?: React.ReactNode
  /** The parents of the current page, nearest to the root first. */
  crumbs?: PageCrumb[]
  /** A small brand logo shown left of the title (integration pages). Not an icon tile. */
  logo?: React.ReactNode
  /** Save feedback, rendered left of `actions`. */
  status?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  as: Heading = 'h1',
  description,
  badge,
  crumbs,
  logo,
  status,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div data-page-header="" className={cn('space-y-1.5', className)}>
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-[13px]">
          {crumbs.map((crumb) => (
            <Fragment key={`${crumb.to ?? ''}:${crumb.label}`}>
              {crumb.to ? (
                <Link
                  to={crumb.to}
                  params={crumb.params}
                  search={crumb.search}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{crumb.label}</span>
              )}
              <span aria-hidden="true" className="text-muted-foreground/60">
                /
              </span>
            </Fragment>
          ))}
          <span aria-current="page" className="text-foreground">
            {title}
          </span>
        </nav>
      )}
      <div
        className={cn(
          'flex min-h-8 flex-wrap justify-between gap-x-4 gap-y-2',
          description ? 'items-start' : 'items-center'
        )}
      >
        <div className="min-w-0 flex-[1_1_16rem]">
          {logo || badge ? (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {logo}
              <Heading className="text-xl font-semibold tracking-tight text-foreground">
                {title}
              </Heading>
              {badge}
            </div>
          ) : (
            <Heading className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </Heading>
          )}
          {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
        </div>
        {(status || actions) && (
          <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">
            {status}
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}
