import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { ChangelogEntryCard } from './changelog-entry-card'
import { EmptyState } from '@/components/shared/empty-state'
import { cn } from '@/lib/shared/utils'
import { publicChangelogQueries, changelogCategoryQueries } from '@/lib/client/queries/changelog'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import type { ChangelogCategoryId } from '@quackback/ids'
import type { PageChoices } from '@/lib/shared/design/page-choices'

/** How the entries run together, and the room each takes, for each layout. */
const LIST_CLASS = {
  timeline: 'divide-y divide-border/40',
  cards: 'space-y-6',
  compact: 'divide-y divide-border/40',
} as const
const ROW_CLASS = { timeline: 'py-10 first:pt-0', cards: '', compact: 'py-5 first:pt-0' } as const
/** The room a loading list keeps, by layout. */
const LOADING_ROOM = {
  timeline: 'min-h-screen',
  cards: 'min-h-screen',
  compact: 'min-h-[50vh]',
} as const

/**
 * The public changelog: its label filters and its entries, laid out as the
 * design chooses; without a choice, dates in a column and no images.
 */
export function ChangelogListPublic({
  entries: layout = 'timeline',
  images = 'none',
  shipped = true,
}: {
  entries?: PageChoices['changelog']['entries']
  images?: PageChoices['changelog']['images']
  /** The posts each entry shipped from; shown unless the design hides them. */
  shipped?: boolean
} = {}) {
  const intl = useIntl()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list()
  )
  const { data: categories = [] } = useQuery(changelogCategoryQueries.list())
  const [activeCategoryId, setActiveCategoryId] = useState<ChangelogCategoryId | null>(null)

  const allEntries = data?.pages.flatMap((page) => page.items) ?? []

  // Only offer chips for categories that actually appear on a loaded entry,
  // so the filter row never shows a label with nothing to show for it.
  const categoriesInUse = useMemo(() => {
    const usedIds = new Set(allEntries.flatMap((e) => e.categories.map((c) => c.id)))
    return categories.filter((c) => usedIds.has(c.id))
  }, [categories, allEntries])

  const entries = activeCategoryId
    ? allEntries.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
    : allEntries

  // While the entries load, the page keeps room for them, so it does not grow
  // under the visitor (and move the footer) when they arrive: the first
  // entry's placeholder in ui/Skeleton's look (qb-skeleton), and about the
  // height a page of entries takes, a screen of full entries or half of one
  // of compact rows. Kept to a few bytes, as every changelog page carries it.
  if (isLoading) {
    return (
      <div aria-busy="true" className={LOADING_ROOM[layout]}>
        <div className="qb-skeleton h-40" />
        <span className="sr-only">
          <FormattedMessage id="portal.changelog.loading" defaultMessage="Loading changelog..." />
        </span>
      </div>
    )
  }

  return (
    <div data-qb-section="entries">
      {categoriesInUse.length > 0 && (
        <div className="mb-8 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategoryId(null)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeCategoryId === null
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            )}
          >
            {intl.formatMessage({ id: 'portal.changelog.filter.all', defaultMessage: 'All' })}
          </button>
          {categoriesInUse.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategoryId(category.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeCategoryId === category.id ? 'text-white' : 'hover:opacity-80'
              )}
              style={{
                backgroundColor:
                  activeCategoryId === category.id ? category.color : category.color + '1a',
                color: activeCategoryId === category.id ? '#fff' : category.color,
              }}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={DocumentTextIcon}
          title={intl.formatMessage(
            activeCategoryId
              ? {
                  id: 'portal.changelog.emptyFiltered.title',
                  defaultMessage: 'No updates in this category yet',
                }
              : { id: 'portal.changelog.empty.title', defaultMessage: 'No updates yet' }
          )}
          description={intl.formatMessage({
            id: 'portal.changelog.empty.description',
            defaultMessage: 'Check back soon for the latest product updates and shipped features.',
          })}
        />
      ) : (
        <div className={LIST_CLASS[layout]}>
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className={cn(
                ROW_CLASS[layout],
                'animate-in fade-in duration-200 fill-mode-backwards'
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <ChangelogEntryCard
                id={entry.id}
                title={entry.title}
                content={entry.content}
                contentJson={entry.contentJson}
                publishedAt={entry.publishedAt}
                linkedPosts={entry.linkedPosts}
                categories={entry.categories}
                layout={layout}
                featuredImageUrl={entry.featuredImageUrl}
                image={images}
                shipped={shipped}
              />
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-8">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? (
              <FormattedMessage id="portal.changelog.loadingMore" defaultMessage="Loading..." />
            ) : (
              <FormattedMessage id="portal.changelog.loadMore" defaultMessage="Load more" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
