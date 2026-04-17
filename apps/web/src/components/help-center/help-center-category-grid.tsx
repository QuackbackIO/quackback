import { Link } from '@tanstack/react-router'
import { getTopLevelCategories } from './help-center-utils'
import { CategoryIcon } from './category-icon'

interface SerializedCategory {
  id: string
  parentId?: string | null
  slug: string
  name: string
  icon: string | null
  description: string | null
  articleCount: number
}

interface Editor {
  name: string
  avatarUrl: string | null
}

interface HelpCenterCategoryGridProps {
  categories: SerializedCategory[]
  editors?: Record<string, Editor[]>
}

function EditorAvatars({ editors }: { editors: Editor[] }) {
  if (!editors.length) return null
  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        {editors.slice(0, 3).map((e, i) => (
          <span
            key={`${e.name}-${i}`}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted border border-background text-[9px] font-semibold text-muted-foreground overflow-hidden"
            style={{ marginLeft: i === 0 ? 0 : -6 }}
            title={e.name}
          >
            {e.avatarUrl ? (
              <img src={e.avatarUrl} alt={e.name} className="w-full h-full object-cover" />
            ) : (
              e.name.charAt(0).toUpperCase()
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

export function HelpCenterCategoryGrid({ categories, editors = {} }: HelpCenterCategoryGridProps) {
  const topLevel = getTopLevelCategories(categories)

  if (topLevel.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        No categories yet. Check back soon.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {topLevel.map((cat, index) => {
        const catEditors = editors[cat.id] ?? []
        return (
          <Link
            key={cat.id}
            to={`/hc/categories/${cat.slug}` as '/hc'}
            className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-5 hover:border-border hover:-translate-y-0.5 transition-all duration-200 animate-in fade-in fill-mode-backwards"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <CategoryIcon icon={cat.icon} className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors text-[15px]">
                {cat.name}
              </h3>
              {cat.description && (
                <p className="mt-1 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                  {cat.description}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2.5 mt-1">
              <EditorAvatars editors={catEditors} />
              <span className="text-xs text-muted-foreground/60">
                {cat.articleCount} {cat.articleCount === 1 ? 'article' : 'articles'}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
