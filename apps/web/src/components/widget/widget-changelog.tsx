import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { contentPreview } from '@/lib/shared/utils/string'
import { cn } from '@/lib/shared/utils'
import { publicChangelogQueries, changelogCategoryQueries } from '@/lib/client/queries/changelog'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { getChangelogSeenAt, markChangelogSeen } from './changelog-unread'
import { NewspaperIcon } from '@heroicons/react/24/outline'
import type { ChangelogCategoryId } from '@quackback/ids'
import { WidgetChangelogListSkeleton, WidgetChangelogMoreSkeleton } from './widget-skeletons'
import { ChangelogMetaRow } from './widget-changelog-meta'

interface WidgetChangelogProps {
  /** Team label for the "From {team}" subline; omitted when unknown. */
  teamName?: string | null
  onEntrySelect?: (entryId: string) => void
}

/**
 * Where the visitor was in the list when they left it. The view unmounts on
 * every push into an entry (the transition remounts it), so the scroll offset
 * and active filter live at module scope and are restored on the next mount —
 * the same "pick up where you left off" the kept-mounted Feedback view gets
 * for free. Module state is per iframe, i.e. per widget session.
 */
const lastVisit: {
  scrollTop: number
  categoryId: ChangelogCategoryId | null
  /** Seen marker as it stood when the list first had data this session;
   *  `undefined` until captured. Lives here, not in the component, because
   *  opening an entry unmounts the list and the marker has advanced by then. */
  seenBaseline: string | null | undefined
} = {
  scrollTop: 0,
  categoryId: null,
  seenBaseline: undefined,
}

/** Filtered pages to pull ahead before conceding "nothing in this category". */
const FILTER_LOOKAHEAD_MIN_ROWS = 3

export function WidgetChangelog({ teamName, onEntrySelect }: WidgetChangelogProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, isLoading } =
    useInfiniteQuery(publicChangelogQueries.list())
  const { data: categories = [] } = useQuery(changelogCategoryQueries.list())
  const [activeCategoryId, setActiveCategoryId] = useState<ChangelogCategoryId | null>(
    lastVisit.categoryId
  )
  useEffect(() => {
    lastVisit.categoryId = activeCategoryId
  }, [activeCategoryId])

  const allEntries = data?.pages.flatMap((page) => page.items) ?? []

  // The launcher badge counted unread entries; the list should show which.
  // Capture the seen marker once per session, when the list first has data —
  // before the effect below advances it — so "New" holds across detail
  // round-trips and not just this mount.
  if (data && lastVisit.seenBaseline === undefined) lastVisit.seenBaseline = getChangelogSeenAt()
  const baseline = lastVisit.seenBaseline ? new Date(lastVisit.seenBaseline).getTime() : null
  const isNew = (publishedAt: string) =>
    baseline !== null && new Date(publishedAt).getTime() > baseline

  const categoriesInUse = useMemo(() => {
    const usedIds = new Set(allEntries.flatMap((e) => e.categories.map((c) => c.id)))
    return categories.filter((c) => usedIds.has(c.id))
  }, [categories, allEntries])

  const entries = activeCategoryId
    ? allEntries.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
    : allEntries

  // Entries on screen are seen: advance the visitor's marker to the newest
  // VISIBLE entry so the launcher badge clears. The list is newest-first, so
  // the first entry carries the max publishedAt. Under a restored category
  // filter a newer entry from another category is not on screen, so it must
  // keep its badge (the marker only ever moves forward, so this is safe).
  useEffect(() => {
    const newest = entries[0]?.publishedAt
    if (newest) markChangelogSeen(newest)
  }, [entries])

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage ?? false,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  // Filtering is client-side over the pages loaded so far, so a sparse
  // category could show "nothing yet" while later pages hold matches. Pull
  // pages ahead until the filtered list has a few rows (or pages run out).
  // A failed page stops the automatic pull — otherwise a dead API would be
  // re-requested in a tight loop — and the empty state shows; the scroll
  // sentinel below it still retries on the visitor's own scrolling.
  const filteredLookahead =
    activeCategoryId !== null &&
    entries.length < FILTER_LOOKAHEAD_MIN_ROWS &&
    (hasNextPage ?? false) &&
    !isFetchNextPageError
  useEffect(() => {
    if (filteredLookahead && !isFetchingNextPage) void fetchNextPage()
  }, [filteredLookahead, isFetchingNextPage, fetchNextPage])

  // Scroll restore: put the viewport back where it was once the (cached) list
  // has painted, then track every scroll so the next visit can do the same.
  const viewportRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el || isLoading) return
    if (lastVisit.scrollTop > 0) el.scrollTop = lastVisit.scrollTop
    const onScroll = () => {
      lastVisit.scrollTop = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isLoading])

  if (isLoading) {
    return <WidgetChangelogListSkeleton />
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
    <ScrollArea
      scrollBarClassName="w-1.5"
      className="flex-1 min-h-0 h-full"
      viewportRef={viewportRef}
    >
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
              aria-pressed={activeCategoryId === null}
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
                aria-pressed={activeCategoryId === category.id}
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

        {entries.length === 0 && !filteredLookahead ? (
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
                <ChangelogMetaRow
                  publishedAt={entry.publishedAt}
                  categories={entry.categories}
                  isNew={isNew(entry.publishedAt)}
                  className="mb-1"
                />
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
          <div ref={sentinelRef} className="min-h-4">
            {isFetchingNextPage && <WidgetChangelogMoreSkeleton />}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
