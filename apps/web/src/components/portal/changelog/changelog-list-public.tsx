'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ChangelogEntryCard } from './changelog-entry-card'
import { EmptyState } from '@/components/shared/empty-state'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

export function ChangelogListPublic() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list()
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-muted-foreground">Loading changelog...</div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={DocumentTextIcon}
        title="No updates yet"
        description="Check back soon for the latest product updates and shipped features."
      />
    )
  }

  return (
    <div>
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <ChangelogEntryCard
            id={entry.id}
            title={entry.title}
            content={entry.content}
            publishedAt={entry.publishedAt}
            linkedPosts={entry.linkedPosts}
          />
        </div>
      ))}

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
