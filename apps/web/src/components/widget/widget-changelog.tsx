import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { contentPreview } from '@/lib/shared/utils/string'
import { cn } from '@/lib/shared/utils'
import { publicChangelogQueries, changelogCategoryQueries } from '@/lib/client/queries/changelog'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { NewspaperIcon } from '@heroicons/react/24/outline'
import type { ChangelogCategoryId } from '@quackback/ids'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface WidgetChangelogProps {
  /** Team label for the "From {team}" subline; omitted when unknown. */
  teamName?: string | null
  onEntrySelect?: (entryId: string) => void
}

export function WidgetChangelog({ teamName, onEntrySelect }: WidgetChangelogProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list()
  )
  const { data: categories = [] } = useQuery(changelogCategoryQueries.list())
  const [activeCategoryId, setActiveCategoryId] = useState<ChangelogCategoryId | null>(null)

  const allEntries = data?.pages.flatMap((page) => page.items) ?? []

  const categoriesInUse = useMemo(() => {
    const usedIds = new Set(allEntries.flatMap((e) => e.categories.map((c) => c.id)))
    return categories.filter((c) => usedIds.has(c.id))
  }, [categories, allEntries])

  const entries = activeCategoryId
    ? allEntries.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
    : allEntries

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage ?? false,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">
          <FormattedMessage id="widget.changelog.loading" defaultMessage="Loading changelog..." />
        </div>
      </div>
    )
  }

  if (allEntries.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center py-10 text-center px-4">
        <NewspaperIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm font-medium text-muted-foreground/70">
          <FormattedMessage id="widget.changelog.empty" defaultMessage="No updates yet" />
        </p>
        <p className="text-xs text-muted-foreground/50 mt-0.5">
          <FormattedMessage
            id="widget.changelog.emptyHint"
            defaultMessage="Check back soon for the latest product updates."
          />
        </p>
      </div>
    )
  }

  return (
    <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
      <div className="px-3 pt-2 pb-3">
        <header className="px-1 pb-2">
          <h2 className="text-base font-semibold text-foreground">
            <FormattedMessage id="widget.changelog.latest" defaultMessage="Latest" />
          </h2>
          {teamName && (
            <p className="text-xs text-muted-foreground">
              <FormattedMessage
                id="widget.changelog.latestFrom"
                defaultMessage="From {team}"
                values={{ team: teamName }}
              />
            </p>
          )}
        </header>

        {categoriesInUse.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1 px-1">
            <button
              type="button"
              onClick={() => setActiveCategoryId(null)}
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                activeCategoryId === null
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              )}
            >
              <FormattedMessage id="widget.changelog.filter.all" defaultMessage="All" />
            </button>
            {categoriesInUse.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategoryId(category.id)}
                className="rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors"
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
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            <FormattedMessage
              id="widget.changelog.emptyFiltered"
              defaultMessage="No updates in this category yet"
            />
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onEntrySelect?.(entry.id)}
                className="w-full text-start rounded-xl border border-border/50 bg-card hover:bg-muted/30 transition-colors px-3.5 py-3 cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1">
                  <time className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                    {formatDate(entry.publishedAt)}
                  </time>
                </div>
                <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
                  {entry.title}
                </h3>
                <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                  {contentPreview(entry.content, 120)}
                </p>
              </button>
            ))}
          </div>
        )}

        {hasNextPage && (
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage && (
              <span className="text-[10px] text-muted-foreground/50">
                <FormattedMessage id="widget.changelog.loadingMore" defaultMessage="Loading..." />
              </span>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
