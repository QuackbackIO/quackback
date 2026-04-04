import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'
import { getTopLevelCategories, getActiveCategory } from './help-center-utils'
import { HelpCenterCompactSearch } from './help-center-search'

interface SerializedCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

interface HelpCenterHeaderProps {
  orgName: string
  orgLogo: string | null
  categories: SerializedCategory[]
}

export function HelpCenterHeader({ orgName, orgLogo, categories }: HelpCenterHeaderProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeSlug = getActiveCategory(pathname)
  const isLanding = pathname === '/'
  const topLevelCategories = getTopLevelCategories(categories)

  return (
    <div className="w-full py-2 border-b border-[var(--header-border)] bg-[var(--header-background)]">
      {/* Row 1: Logo + Name + Search */}
      <div>
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6">
          <div className="flex h-12 items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              {orgLogo ? (
                <img
                  src={orgLogo}
                  alt={orgName}
                  className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)]"
                />
              ) : (
                <div className="h-8 w-8 [border-radius:calc(var(--radius)*0.6)] bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                  {orgName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-semibold hidden sm:block max-w-[18ch] line-clamp-2 text-[var(--header-foreground)]">
                {orgName}
              </span>
            </Link>
            {!isLanding && <HelpCenterCompactSearch />}
          </div>
        </div>
      </div>

      {/* Row 2: Category tabs */}
      <div className="mt-2">
        <div className="max-w-6xl mx-auto w-full px-4 sm:px-6">
          <nav className="flex items-center gap-1 overflow-x-auto">
            <Link
              to="/"
              className={cn(
                'px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap [border-radius:calc(var(--radius)*0.8)]',
                activeSlug === null
                  ? 'bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
                  : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
              )}
            >
              All
            </Link>
            {topLevelCategories.map((cat) => (
              <a
                key={cat.id}
                href={`/${cat.slug}`}
                className={cn(
                  'px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap [border-radius:calc(var(--radius)*0.8)]',
                  activeSlug === cat.slug
                    ? 'bg-[var(--nav-active-background)] text-[var(--nav-active-foreground)]'
                    : 'text-[var(--nav-inactive-color)] hover:text-[var(--nav-active-foreground)] hover:bg-[var(--nav-active-background)]/50'
                )}
              >
                {cat.icon && <span className="mr-1">{cat.icon}</span>}
                {cat.name}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
