import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { DocumentTextIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { CategoryIcon } from '@/components/help-center/category-icon'
import { localizedHcPath } from '@/lib/shared/help-center-url'

const categoryApi = getRouteApi('/_portal/hc/$locale/categories/$categorySlug')

export const Route = createFileRoute('/_portal/hc/$locale/categories/$categorySlug/')({
  component: LocaleCategoryIndexPage,
})

function LocaleCategoryIndexPage() {
  const { category, articles } = categoryApi.useLoaderData()
  const { locale } = categoryApi.useParams()

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <div className="min-w-0 py-10">
        <div className="mt-2 mb-8">
          <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center mb-5">
            <CategoryIcon icon={category.icon} className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">{category.name}</h1>
          {category.description && (
            <p className="mt-2 text-muted-foreground leading-relaxed">{category.description}</p>
          )}
        </div>

        {articles.length === 0 ? (
          <p className="text-muted-foreground">No articles in this category yet.</p>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/50 bg-card">
            {articles.map((article) => (
              <Link
                key={article.id}
                to={
                  localizedHcPath(
                    locale,
                    `/hc/articles/${category.slug}/${article.slug}`
                  ) as '/hc'
                }
                className="group flex items-start gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
              >
                <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="block text-sm text-foreground group-hover:text-primary transition-colors font-medium">
                    {article.title}
                  </span>
                  {article.description && (
                    <span className="block text-xs text-muted-foreground/60 mt-0.5 line-clamp-1">
                      {article.description}
                    </span>
                  )}
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors mt-0.5" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
