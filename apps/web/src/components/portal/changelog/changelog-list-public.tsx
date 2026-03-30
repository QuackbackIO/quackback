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
        <div className="text-muted-foreground">Carregando changelog...</div>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={DocumentTextIcon}
        title="Ainda não há atualizações"
        description="Volte em breve para ver as últimas atualizações do produto e funcionalidades lançadas."
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
            {isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  )
}
