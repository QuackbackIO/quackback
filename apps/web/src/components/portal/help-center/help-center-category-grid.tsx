import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { EmptyState } from '@/components/shared/empty-state'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'

export function HelpCenterCategoryGrid() {
  const { data: categories, isLoading } = useQuery(publicHelpCenterQueries.categories())

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-muted-foreground">Loading help center...</div>
      </div>
    )
  }

  if (!categories || categories.length === 0) {
    return (
      <EmptyState
        icon={QuestionMarkCircleIcon}
        title="No help articles yet"
        description="Check back soon for helpful guides and documentation."
      />
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((cat, index) => (
        <Link
          key={cat.id}
          to="/help/$categorySlug"
          params={{ categorySlug: cat.slug }}
          className="group rounded-xl border border-border/50 bg-card p-6 hover:border-border hover:shadow-sm transition-all animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <h3 className="text-base font-semibold text-foreground group-hover:text-primary transition-colors">
            {cat.name}
          </h3>
          {cat.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{cat.description}</p>
          )}
          <p className="text-xs text-muted-foreground/60 mt-3">
            {cat.articleCount} {cat.articleCount === 1 ? 'article' : 'articles'}
          </p>
        </Link>
      ))}
    </div>
  )
}
