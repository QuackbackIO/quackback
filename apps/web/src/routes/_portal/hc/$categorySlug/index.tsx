import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { ArrowRightIcon } from '@heroicons/react/16/solid'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import { buildCategoryBreadcrumbs } from '@/components/help-center/help-center-utils'
import { JsonLd } from '@/components/json-ld'
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from '@/lib/shared/json-ld'

const helpCenterApi = getRouteApi('/_portal/hc')
const categoryApi = getRouteApi('/_portal/hc/$categorySlug')

export const Route = createFileRoute('/_portal/hc/$categorySlug/')({
  component: CategoryIndexPage,
})

function CategoryIndexPage() {
  const { categorySlug } = Route.useParams()
  const { category, articles, allCategories, subcategories } = categoryApi.useLoaderData()
  const { helpCenterConfig } = helpCenterApi.useLoaderData()
  const { baseUrl } = Route.useRouteContext()

  const breadcrumbs = buildCategoryBreadcrumbs({
    allCategories,
    categoryId: category.id,
  })

  const seoEnabled = helpCenterConfig?.seo?.structuredDataEnabled !== false
  const resolvedBaseUrl = baseUrl ?? ''

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      {seoEnabled && (
        <>
          <JsonLd
            data={buildCollectionPageJsonLd({
              name: category.name,
              description: category.description ?? null,
            })}
          />
          <JsonLd
            data={buildBreadcrumbJsonLd([
              { name: 'Help Center', url: resolvedBaseUrl || '/' },
              { name: category.name, url: `${resolvedBaseUrl}/${category.slug}` },
            ])}
          />
        </>
      )}

      <HelpCenterBreadcrumbs items={breadcrumbs} />

      {/* Category header */}
      <div className="mt-6 mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          {category.icon && <span className="text-2xl">{category.icon}</span>}
          {category.name}
        </h1>
        {category.description && (
          <p className="mt-2 text-muted-foreground">{category.description}</p>
        )}
      </div>

      {/* Subcategory cards */}
      {subcategories && subcategories.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Sub-categories
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subcategories.map((sub) => (
              <a
                key={sub.id}
                href={`/hc/${sub.slug}`}
                className="group rounded-lg border border-border/50 bg-card p-4 hover:border-border hover:shadow-sm transition-all flex items-start gap-3"
              >
                <span className="text-2xl shrink-0">{sub.icon || '📁'}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                    {sub.name}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {sub.articles.length} article{sub.articles.length === 1 ? '' : 's'}
                  </div>
                </div>
                <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors mt-0.5" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Article list */}
      {articles.length === 0 && (!subcategories || subcategories.length === 0) ? (
        <p className="text-muted-foreground">No articles in this category yet.</p>
      ) : articles.length > 0 ? (
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Articles ({articles.length})
          </h2>
          <div className="space-y-2">
            {articles.map((article) => (
              <a
                key={article.id}
                href={`/hc/${categorySlug}/${article.slug}`}
                className="group flex items-center justify-between rounded-lg border border-border/50 bg-card p-4 hover:border-border hover:shadow-sm transition-all"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {article.title}
                  </h2>
                  {article.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-1">
                      {article.description}
                    </p>
                  )}
                </div>
                <ArrowRightIcon className="ml-3 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
