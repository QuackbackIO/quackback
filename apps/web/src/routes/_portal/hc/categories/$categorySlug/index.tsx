import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { DocumentTextIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { ArrowLeft, FileText, Folder } from 'lucide-react'
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

  const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500']
  const bg = colors[index % colors.length]

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
  readingTimeMinutes,
}: {
  href: string
  title: string
  readingTimeMinutes?: number
}) {
  return (
    <Link
      to={href as '/hc'}
      className="group flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors"
    >
      <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      <span className="text-sm text-foreground group-hover:text-primary transition-colors flex-1 min-w-0 font-medium">
        {title}
      </span>
      {readingTimeMinutes != null && (
        <span className="text-xs text-muted-foreground/50 shrink-0 tabular-nums">
          {readingTimeMinutes} min read
        </span>
      )}
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
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

  const topLevelCategories = getTopLevelCategories(allCategories)

  const seoEnabled = helpCenterConfig?.seo?.structuredDataEnabled !== false
  const resolvedBaseUrl = baseUrl ?? ''

  const totalArticles =
    articles.length + subcategories.reduce((sum, s) => sum + s.articles.length, 0)

  // Deduplicate editors from article author data
  const editors: Author[] = []
  const seenNames = new Set<string>()
  for (const a of articles) {
    if (a.authorName && !seenNames.has(a.authorName)) {
      seenNames.add(a.authorName)
      editors.push({ name: a.authorName, avatarUrl: a.authorAvatarUrl ?? null })
      if (editors.length >= 3) break
    }
  }

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
          <div className="hidden w-60 shrink-0 xl:block">
            <aside className="sticky top-14 h-[calc(100vh-3.5rem)] hidden flex-col py-8 pl-4 pr-2 xl:flex">
              <Link
                to="/hc"
                className="mb-5 shrink-0 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="truncate">All Categories</span>
              </Link>
              <h4 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Categories
              </h4>
              <ScrollArea className="min-h-0 flex-1" scrollBarClassName="w-1.5">
                <ul className="space-y-0.5 overflow-x-hidden pr-2">
                  {topLevelCategories.map((cat) => {
                    const isActive = cat.id === category.id
                    return (
                      <li key={cat.id}>
                        <Link
                          to={`/hc/categories/${cat.slug}` as '/hc'}
                          className={cn(
                            'flex w-full items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-[13px] leading-snug transition-colors',
                            isActive
                              ? 'bg-secondary text-foreground font-medium'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          )}
                        >
                          <Folder className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          <span className="min-w-0 truncate">{cat.name}</span>
                        </Link>
                        {isActive && articles.length > 0 && (
                          <ul className="mt-0.5 ml-3 space-y-0.5 pr-4">
                            {articles.map((a) => (
                              <li key={a.id}>
                                <Link
                                  to={`/hc/articles/${cat.slug}/${a.slug}` as '/hc'}
                                  className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] leading-snug text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                                  <span>{a.title}</span>
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
