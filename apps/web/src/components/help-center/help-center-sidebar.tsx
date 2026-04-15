import { useParams } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'

interface SidebarArticle {
  id: string
  slug: string
  title: string
}

interface SidebarSubcategory {
  id: string
  slug: string
  name: string
  icon: string | null
  articles: SidebarArticle[]
}

interface HelpCenterSidebarProps {
  categoryName: string
  categorySlug: string
  categoryIcon: string | null
  articles: SidebarArticle[]
  subcategories: SidebarSubcategory[]
}

export function HelpCenterSidebar({
  categoryName,
  categorySlug,
  categoryIcon,
  articles,
  subcategories,
}: HelpCenterSidebarProps) {
  // useParams with strict: false to get articleSlug from any child route
  const params = useParams({ strict: false }) as { articleSlug?: string }
  const activeArticleSlug = params.articleSlug

  return (
    <aside className="hidden md:block w-56 shrink-0 border-r border-border overflow-y-auto py-6 pr-4">
      {/* Category heading */}
      <div className="mb-3 px-2">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          {categoryIcon && <span>{categoryIcon}</span>}
          {categoryName}
        </h2>
      </div>

      {/* Articles in this category */}
      <ul className="space-y-0.5">
        {articles.map((article) => (
          <li key={article.id}>
            <a
              href={`/hc/${categorySlug}/${article.slug}`}
              className={cn(
                'block rounded-md px-2 py-1.5 text-sm transition-colors',
                activeArticleSlug === article.slug
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {article.title}
            </a>
          </li>
        ))}
      </ul>

      {/* Subcategories */}
      {subcategories.map((sub) => (
        <div key={sub.id} className="mt-4">
          <div className="mb-1 px-2">
            <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <span className="text-muted-foreground/60">&#8627;</span>
              {sub.icon && <span>{sub.icon}</span>}
              {sub.name}
            </h3>
          </div>
          <ul className="space-y-0.5 pl-3">
            {sub.articles.map((article) => (
              <li key={article.id}>
                <a
                  href={`/hc/${categorySlug}/${article.slug}`}
                  className={cn(
                    'block rounded-md px-2 py-1.5 text-sm transition-colors',
                    activeArticleSlug === article.slug
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
                >
                  {article.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  )
}
