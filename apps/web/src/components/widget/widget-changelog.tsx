import { useInfiniteQuery } from '@tanstack/react-query'
import { ScrollArea } from '@/components/ui/scroll-area'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { NewspaperIcon } from '@heroicons/react/24/outline'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function truncateContent(content: string, maxLength = 120): string {
  const plain = content
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
  if (plain.length <= maxLength) return plain
  return plain.slice(0, maxLength).trimEnd() + '...'
}

interface WidgetChangelogProps {
  onEntrySelect?: (entryId: string) => void
}

export function WidgetChangelog({ onEntrySelect }: WidgetChangelogProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list()
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

  const sentinelRef = useInfiniteScroll({
    hasMore: hasNextPage ?? false,
    isFetching: isFetchingNextPage,
    onLoadMore: fetchNextPage,
  })

  if (isLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center py-10">
        <div className="text-sm text-muted-foreground">Loading changelog...</div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center py-10 text-center px-4">
        <NewspaperIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm font-medium text-muted-foreground/70">No updates yet</p>
        <p className="text-xs text-muted-foreground/50 mt-0.5">
          Check back soon for the latest product updates.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1 min-h-0 h-full">
      <div className="px-3 pt-2 pb-3">
        <div className="space-y-1">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onEntrySelect?.(entry.id)}
              className="w-full text-left rounded-lg hover:bg-muted/30 transition-colors px-2.5 py-2.5 cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1">
                <time className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                  {formatDate(entry.publishedAt)}
                </time>
              </div>
              <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                {entry.title}
              </h3>
              <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                {truncateContent(entry.content)}
              </p>
            </button>
          ))}
        </div>

        {hasNextPage && (
          <div ref={sentinelRef} className="flex justify-center py-2">
            {isFetchingNextPage && (
              <span className="text-[10px] text-muted-foreground/50">Loading...</span>
            )}
          </div>
        )}
      </div>
    </ScrollArea>
  )
}
