import { useInfiniteQuery } from '@tanstack/react-query'
import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { ChangelogEntryCard } from './changelog-entry-card'
import { EmptyState } from '@/components/shared/empty-state'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

export function ChangelogListPublic() {
  const intl = useIntl()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicChangelogQueries.list()
  )

  const entries = data?.pages.flatMap((page) => page.items) ?? []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-muted-foreground">
          <FormattedMessage id="portal.changelog.loading" defaultMessage="Loading changelog..." />
        </div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={DocumentTextIcon}
        title={intl.formatMessage({
          id: 'portal.changelog.empty.title',
          defaultMessage: 'No updates yet',
        })}
        description={intl.formatMessage({
          id: 'portal.changelog.empty.description',
          defaultMessage: 'Check back soon for the latest product updates and shipped features.',
        })}
      />
    )
  }

  return (
    <div className="divide-y divide-border/40">
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          className="py-10 first:pt-0 animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <ChangelogEntryCard
            id={entry.id}
            title={entry.title}
            content={entry.content}
            contentJson={entry.contentJson}
            publishedAt={entry.publishedAt}
            linkedPosts={entry.linkedPosts}
          />
        </div>
      ))}

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
