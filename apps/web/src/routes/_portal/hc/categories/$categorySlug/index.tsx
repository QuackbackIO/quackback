import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import {
  DocumentTextIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'
import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HelpCenterBreadcrumbs } from '@/components/help-center/help-center-breadcrumbs'
import {
  buildCategoryBreadcrumbs,
  getTopLevelCategories,
} from '@/components/help-center/help-center-utils'
import { JsonLd } from '@/components/json-ld'
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd } from '@/lib/shared/json-ld'
import { cn } from '@/lib/shared/utils'
import { CategoryIcon } from '@/components/help-center/category-icon'

const MAX_ARTICLES_SHOWN = 8
const AUTHOR_COLORS = [
  'bg-emerald-500',
  'bg-blue-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
]

const helpCenterApi = getRouteApi('/_portal/hc')
const categoryApi = getRouteApi('/_portal/hc/categories/$categorySlug')

export const Route = createFileRoute('/_portal/hc/categories/$categorySlug/')({
  component: CategoryIndexPage,
})

interface Author {
  name: string
  avatarUrl: string | null
}

function AuthorAvatar({ author, index }: { author: Author; index: number }) {
  const initials = author.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const bg = AUTHOR_COLORS[index % AUTHOR_COLORS.length]

  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold text-white overflow-hidden border-2 border-background ${bg}`}
      style={{ marginLeft: index === 0 ? 0 : -8 }}
      title={author.name}
    >
      {author.avatarUrl ? (
        <img src={author.avatarUrl} alt={author.name} className="w-full h-full object-cover" />
      ) : (
        initials
      )}
    </span>
  )
}

function ArticleRow({
  href,
  title,
  description,
  readingTimeMinutes,
}: {
  href: string
  title: string
  description?: string | null
  readingTimeMinutes?: number
}) {
  return (
    <Link
      to={href as '/hc'}
      className="group flex items-start gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="block text-sm text-foreground group-hover:text-primary transition-colors font-medium">
          {title}
        </span>
        {description && (
          <span className="block text-xs text-muted-foreground/60 mt-0.5 line-clamp-1">
            {description}
          </span>
        )}
      </div>
      {readingTimeMinutes != null && (
        <span className="text-xs text-muted-foreground/50 shrink-0 tabular-nums mt-0.5">
          {readingTimeMinutes} min read
        </span>
      )}
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors mt-0.5" />
    </Link>
  )
}

function CategoryIndexPage() {
  const { categorySlug } = Route.useParams()
  const { category, articles, allCategories, subcategories } = categoryApi.useLoaderData()
  const { helpCenterConfig } = helpCenterApi.useLoaderData()
  const { baseUrl } = Route.useRouteContext()

  const breadcrumbs = buildCategoryBreadcrumbs({
    allCategories,
    categoryId: category.id,
  })

  const topLevelCategories = useMemo(() => getTopLevelCategories(allCategories), [allCategories])

  const seoEnabled = helpCenterConfig?.seo?.structuredDataEnabled !== false
  const resolvedBaseUrl = baseUrl ?? ''

  const totalArticles =
    articles.length + subcategories.reduce((sum, s) => sum + s.articles.length, 0)

  const editors = useMemo(() => {
    const result: Author[] = []
    const seen = new Set<string>()
    for (const a of articles) {
      if (a.authorName && !seen.has(a.authorName)) {
        seen.add(a.authorName)
        result.push({ name: a.authorName, avatarUrl: a.authorAvatarUrl ?? null })
        if (result.length >= 3) break
      }
    }
    return result
  }, [articles])

  return (
    <>
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
              {
                name: category.name,
                url: `${resolvedBaseUrl}/categories/${category.slug}`,
              },
            ])}
          />
        </>
      )}

      <div className="px-4 sm:px-6 md:px-8">
        <div className="relative flex justify-center gap-8 xl:gap-12">
          {/* Left: category nav */}
          <div className="hidden w-56 shrink-0 overflow-hidden xl:block">
            <aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-full flex-col overflow-hidden py-6 pl-3 pr-2 xl:flex">
              <Link
                to="/hc"
                className="mb-4 shrink-0 inline-flex w-full items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">All categories</span>
              </Link>
              <p className="mb-1.5 shrink-0 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                Browse
              </p>
              <ScrollArea className="min-h-0 flex-1" scrollBarClassName="w-1.5">
                <ul className="w-full space-y-px pr-1">
                  {topLevelCategories.map((cat) => {
                    const isActive = cat.id === category.id
                    const Chevron = isActive ? ChevronDownIcon : ChevronRightIcon
                    return (
                      <li key={cat.id} className="w-full">
                        <Link
                          to={`/hc/categories/${cat.slug}` as '/hc'}
                          className={cn(
                            'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs leading-snug transition-colors',
                            isActive
                              ? 'bg-secondary font-semibold text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          )}
                        >
                          <Chevron className="h-3 w-3 shrink-0 opacity-40" />
                          <CategoryIcon
                            icon={cat.icon}
                            className="h-3.5 w-3.5 shrink-0 opacity-50"
                          />
                          <span className="min-w-0 truncate">{cat.name}</span>
                        </Link>
                        {isActive && subcategories.length > 0 && (
                          <ul className="mt-px ml-4 w-full space-y-px pr-1">
                            {subcategories.map((sub) => (
                              <li key={sub.id} className="w-full">
                                <Link
                                  to={`/hc/categories/${sub.slug}` as '/hc'}
                                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs leading-snug text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                >
                                  <ChevronRightIcon className="h-3 w-3 shrink-0 opacity-40" />
                                  <span className="min-w-0 flex-1 truncate">{sub.name}</span>
                                  {sub.articles.length > 0 && (
                                    <span className="shrink-0 tabular-nums text-muted-foreground/40">
                                      {sub.articles.length}
                                    </span>
                                  )}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </ScrollArea>
            </aside>
          </div>

          {/* Main content */}
          <div className="min-w-0 max-w-2xl flex-1 py-10">
            <HelpCenterBreadcrumbs items={breadcrumbs} />

            {/* Category header */}
            <div className="mt-6 mb-8">
              <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center mb-5">
                <CategoryIcon icon={category.icon} className="w-8 h-8 text-primary-foreground" />
              </div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">{category.name}</h1>
              {category.description && (
                <p className="mt-2 text-muted-foreground leading-relaxed">{category.description}</p>
              )}

              {editors.length > 0 && (
                <div className="mt-4 flex items-center gap-2.5 text-sm text-muted-foreground">
                  <div className="flex">
                    {editors.map((e, i) => (
                      <AuthorAvatar key={e.name} author={e} index={i} />
                    ))}
                  </div>
                  <span>
                    By <span className="font-semibold text-foreground">{editors[0].name}</span>
                    {editors.length > 1 && (
                      <>
                        {' '}
                        and {editors.length - 1} other{editors.length > 2 ? 's' : ''}
                      </>
                    )}
                  </span>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{totalArticles} articles</span>
                </div>
              )}
            </div>

            {/* Subcategory sections */}
            {subcategories && subcategories.length > 0 && (
              <div className="mb-8 space-y-8">
                {subcategories.map((sub) => {
                  const shown = sub.articles.slice(0, MAX_ARTICLES_SHOWN)
                  const remaining = sub.articles.length - shown.length
                  return (
                    <section key={sub.id}>
                      <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/50 bg-card">
                        <div className="flex items-center gap-2.5 px-5 py-3 bg-muted/40">
                          <CategoryIcon icon={sub.icon} className="w-5 h-5 shrink-0" />
                          <h2 className="text-sm font-semibold text-foreground">{sub.name}</h2>
                        </div>
                        {shown.length > 0 ? (
                          <>
                            {shown.map((article) => (
                              <ArticleRow
                                key={article.id}
                                href={`/hc/articles/${sub.slug}/${article.slug}`}
                                title={article.title}
                                description={article.description}
                                readingTimeMinutes={article.readingTimeMinutes}
                              />
                            ))}
                            {remaining > 0 && (
                              <Link
                                to={`/hc/categories/${sub.slug}` as '/hc'}
                                className="flex items-center justify-center px-5 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
                              >
                                View all {sub.articles.length} articles
                              </Link>
                            )}
                          </>
                        ) : (
                          <p className="px-5 py-3.5 text-sm text-muted-foreground">
                            No articles yet.
                          </p>
                        )}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}

            {/* Direct articles */}
            {articles.length === 0 && (!subcategories || subcategories.length === 0) ? (
              <p className="text-muted-foreground">No articles in this category yet.</p>
            ) : articles.length > 0 ? (
              <div className="rounded-xl border border-border/50 overflow-hidden divide-y divide-border/50 bg-card">
                {articles.map((article) => (
                  <ArticleRow
                    key={article.id}
                    href={`/hc/articles/${categorySlug}/${article.slug}`}
                    title={article.title}
                    description={article.description}
                    readingTimeMinutes={article.readingTimeMinutes}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {/* Right: empty balance column */}
          <div className="hidden w-56 shrink-0 xl:block" />
        </div>
      </div>
    </>
  )
}
