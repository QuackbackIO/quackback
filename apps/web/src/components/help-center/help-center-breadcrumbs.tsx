import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from '@heroicons/react/16/solid'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface HelpCenterBreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function HelpCenterBreadcrumbs({ items }: HelpCenterBreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-sm text-muted-foreground"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={item.label} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
            {isLast || !item.href ? (
              <span className={isLast ? 'text-foreground font-medium' : undefined}>
                {item.label}
              </span>
            ) : (
              <Link to={item.href} className="hover:text-foreground transition-colors">
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
