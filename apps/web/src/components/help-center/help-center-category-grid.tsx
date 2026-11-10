import { Suspense, type CSSProperties, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { FormattedMessage } from 'react-intl'
import { getTopLevelCategories } from './help-center-utils'
import { CategoryIcon } from './category-icon'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath, hcCollectionPath } from '@/lib/shared/help-center-url'
import { cn } from '@/lib/shared/utils'

/** The topics' grid: one column on a phone, two on a tablet, three on a wide screen. */
const TOPICS_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
/**
 * Within a block narrower than the page, as on Home, no more columns than the
 * block has room for: one below 30rem (a third of the page), two below 40rem
 * (half of it). Wider, as the screen gives.
 */
const FIT_GRID = '@max-[30rem]:grid-cols-1! @min-[30rem]:@max-[40rem]:lg:grid-cols-2!'

/** The topics' grid, fitted to the block it is in when asked. */
function TopicsGrid({ fit, children }: { fit: boolean; children: ReactNode }) {
  const grid = (
    <div data-qb-topics={fit ? '' : undefined} className={cn(TOPICS_GRID, fit && FIT_GRID)}>
      {children}
    </div>
  )
  return fit ? <div className="@container">{grid}</div> : grid
}

interface SerializedCategory {
  id: string
  urlId: number
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
  /** Cards in a grid, or rows on one card. */
  layout?: 'cards' | 'list'
  /** Each topic's article count; shown unless false. */
  counts?: boolean
  /** Each topic a way into it; false draws them still, as the builder's samples are. */
  linked?: boolean
  /** No more columns than the block it is in has room for, as on Home. */
  fit?: boolean
}

export function HelpCenterCategoryGrid({
  categories,
  locale,
  layout = 'cards',
  counts = true,
  linked = true,
  fit = false,
}: HelpCenterCategoryGridProps) {
  const Way = linked ? Link : Still
  const topLevel = getTopLevelCategories(categories)

  if (topLevel.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <FormattedMessage
          id="portal.hc.categoryGrid.empty"
          defaultMessage="No categories yet. Check back soon."
        />
      </div>
    )
  }

  const pathOf = (cat: SerializedCategory) =>
    hcCollectionPath({
      locale: locale ?? DEFAULT_LOCALE,
      urlId: cat.urlId,
      slug: cat.slug,
    }) as '/hc'

  if (layout === 'list')
    return (
      <ul
        data-qb-surface="card"
        className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card"
      >
        {topLevel.map((cat) => (
          <li key={cat.id}>
            <Way
              to={pathOf(cat)}
              className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <CategoryIcon icon={cat.icon} className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-base font-medium text-foreground">{cat.name}</span>
                {cat.description && (
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {cat.description}
                  </span>
                )}
              </span>
              {counts && (
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                  <FormattedMessage
                    id="portal.hc.articleCount"
                    defaultMessage="{count, plural, one {# article} other {# articles}}"
                    values={{ count: cat.articleCount }}
                  />
                </span>
              )}
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary rtl:rotate-180"
              />
            </Way>
          </li>
        ))}
      </ul>
    )

  return (
    <TopicsGrid fit={fit}>
      {topLevel.map((cat, index) => (
        <Way
          key={cat.id}
          to={
            hcCollectionPath({
              locale: locale ?? DEFAULT_LOCALE,
              urlId: cat.urlId,
              slug: cat.slug,
            }) as '/hc'
          }
          data-qb-surface="card"
          className="group flex items-start gap-4 rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background animate-in fade-in fill-mode-backwards"
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
            {counts && (
              <span className="mt-3 block text-xs font-medium text-muted-foreground">
                <FormattedMessage
                  id="portal.hc.articleCount"
                  defaultMessage="{count, plural, one {# article} other {# articles}}"
                  values={{ count: cat.articleCount }}
                />
              </span>
            )}
          </div>
        </Way>
      ))}
    </TopicsGrid>
  )
}

/** A topic drawn where it cannot be followed, with a link's look and none of its way. */
function Still({
  children,
  className,
  style,
}: {
  to?: unknown
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  )
}

/** A topic's first articles, under it. */
function TopicArticles({ categoryId, count }: { categoryId: string; count: number }) {
  const { data: articles } = useSuspenseQuery(
    publicHelpCenterQueries.articlesForCategory(categoryId)
  )
  if (articles.length === 0) return null
  return (
    <ul className="mt-2 space-y-1">
      {articles.slice(0, count).map((article) => (
        <li key={article.id}>
          <Link
            to={
              hcArticlePath({
                locale: DEFAULT_LOCALE,
                urlId: article.urlId,
                slug: article.slug,
              }) as '/hc'
            }
            className="block truncate text-sm text-foreground hover:underline"
          >
            {article.title}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Topics with their first articles under each: a card per topic, its name the way in. */
export function HelpCenterTopicsWithArticles({
  topics,
  counts,
  articles,
  sample = false,
  fit = false,
}: {
  topics: ReadonlyArray<{
    id: string
    name: string
    articleCount: number
    urlId?: number
    slug?: string
    articles?: readonly string[]
  }>
  counts: boolean
  articles: number
  sample?: boolean
  /** No more columns than the block it is in has room for, as on Home. */
  fit?: boolean
}) {
  return (
    <TopicsGrid fit={fit}>
      {topics.map((topic) => (
        <div
          key={topic.id}
          data-qb-surface="card"
          className="min-w-0 rounded-2xl border border-border bg-card p-5"
        >
          {sample || topic.urlId === undefined ? (
            <h3 className="text-base font-semibold text-foreground">{topic.name}</h3>
          ) : (
            <Link
              to={
                hcCollectionPath({
                  locale: DEFAULT_LOCALE,
                  urlId: topic.urlId,
                  slug: topic.slug ?? '',
                }) as '/hc'
              }
              className="text-base font-semibold text-foreground hover:underline"
            >
              {topic.name}
            </Link>
          )}
          {counts && (
            <span className="mt-1 block text-xs font-medium text-muted-foreground">
              <FormattedMessage
                id="portal.hc.articleCount"
                defaultMessage="{count, plural, one {# article} other {# articles}}"
                values={{ count: topic.articleCount }}
              />
            </span>
          )}
          {sample ? (
            <ul className="mt-2 space-y-1">
              {topic.articles?.slice(0, articles).map((title) => (
                <li key={title} className="truncate text-sm text-foreground">
                  {title}
                </li>
              ))}
            </ul>
          ) : (
            <Suspense fallback={null}>
              <TopicArticles categoryId={topic.id} count={articles} />
            </Suspense>
          )}
        </div>
      ))}
    </TopicsGrid>
  )
}
