'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ChangelogEntryCard } from './changelog-entry-card'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import type { BoardId } from '@quackback/ids'

interface ChangelogListPublicProps {
  boardId?: BoardId
}

export function ChangelogListPublic({ boardId }: ChangelogListPublicProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list(boardId)
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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <DocumentTextIcon className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-medium mb-2">No updates yet</h2>
        <p className="text-muted-foreground max-w-md">
          Check back soon for the latest product updates and shipped features.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
            author={entry.author}
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
