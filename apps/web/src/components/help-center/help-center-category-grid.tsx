import { Link } from '@tanstack/react-router'
import { getTopLevelCategories } from './help-center-utils'
import { CategoryIcon } from './category-icon'
import { localizedHcPath } from '@/lib/shared/help-center-url'

interface SerializedCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

interface HelpCenterCategoryGridProps {
  categories: SerializedCategory[]
  /** Content locale (domains/languages §2); omitted = default locale links. */
  locale?: string
}

export function HelpCenterCategoryGrid({ categories, locale }: HelpCenterCategoryGridProps) {
  const topLevel = getTopLevelCategories(categories)

  if (topLevel.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        No categories yet. Check back soon.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {topLevel.map((cat, index) => (
        <Link
          key={cat.id}
          to={
            (locale
              ? localizedHcPath(locale, `/hc/categories/${cat.slug}`)
              : `/hc/categories/${cat.slug}`) as '/hc'
          }
          className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background animate-in fade-in fill-mode-backwards"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10">
            <CategoryIcon icon={cat.icon} className="size-6 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">{cat.name}</h3>
            {cat.description && (
              <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                {cat.description}
              </p>
            )}
            <span className="mt-3 block text-xs font-medium text-muted-foreground">
              {cat.articleCount} {cat.articleCount === 1 ? 'article' : 'articles'}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}
