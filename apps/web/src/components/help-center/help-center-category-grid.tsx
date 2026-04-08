import { getTopLevelCategories } from './help-center-utils'

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
}

export function HelpCenterCategoryGrid({ categories }: HelpCenterCategoryGridProps) {
  const topLevel = getTopLevelCategories(categories)

  if (topLevel.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        No categories yet. Check back soon.
      </div>
    )
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {topLevel.map((cat, index) => (
        <a
          key={cat.id}
          href={`/hc/${cat.slug}`}
          className="group rounded-xl border border-border/50 bg-card p-6 hover:border-border hover:shadow-sm transition-all animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {cat.icon && <div className="text-2xl mb-2">{cat.icon}</div>}
          <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
            {cat.name}
          </h3>
          {cat.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cat.description}</p>
          )}
          <p className="text-xs text-muted-foreground/60 mt-3">
            {cat.articleCount} {cat.articleCount === 1 ? 'article' : 'articles'}
          </p>
        </a>
      ))}
    </div>
  )
}
