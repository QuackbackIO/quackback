import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'
import { getTopLevelCategories, getActiveCategory } from './help-center-utils'

export interface HelpCenterCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

interface HelpCenterCategoryNavProps {
  categories: HelpCenterCategory[]
}

export function HelpCenterCategoryNav({ categories }: HelpCenterCategoryNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSlug = getActiveCategory(pathname)
  const topLevel = getTopLevelCategories(categories)

  const tabClass = (active: boolean) =>
    cn(
      'px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap [border-radius:calc(var(--radius)*0.8)]',
      active
        ? 'bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
        : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
    )

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Help center categories">
      <Link to="/hc" data-active={activeSlug === null} className={tabClass(activeSlug === null)}>
        All
      </Link>
      {topLevel.map((cat) => {
        const isActive = activeSlug === cat.slug
        return (
          <Link
            key={cat.id}
            to="/hc/$categorySlug"
            params={{ categorySlug: cat.slug }}
            data-active={isActive}
            className={tabClass(isActive)}
          >
            {cat.icon && <span className="mr-1">{cat.icon}</span>}
            {cat.name}
          </Link>
        )
      })}
    </nav>
  )
}
