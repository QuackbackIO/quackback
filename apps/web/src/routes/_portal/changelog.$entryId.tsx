import { createFileRoute, notFound } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { ChangelogEntryDetail } from '@/components/portal/changelog'
import { BackLink } from '@/components/ui/back-link'
import type { ChangelogId } from '@quackback/ids'

export const Route = createFileRoute('/_portal/changelog/$entryId')({
  loader: async ({ context, params }) => {
    const { queryClient } = context
    const entryId = params.entryId as ChangelogId

    try {
      await queryClient.ensureQueryData(publicChangelogQueries.detail(entryId))
    } catch {
      // If entry not found or not published, throw 404
      throw notFound()
    }

    return { entryId }
  },
  notFoundComponent: ChangelogNotFound,
  component: ChangelogEntryPage,
})

function ChangelogEntryPage() {
  const { entryId } = Route.useLoaderData()
  const { data: entry } = useSuspenseQuery(publicChangelogQueries.detail(entryId))

  return (
    <div className="py-8">
      <div className="animate-in fade-in duration-200 fill-mode-backwards">
        <ChangelogEntryDetail
          id={entry.id}
          title={entry.title}
          content={entry.content}
          contentJson={entry.contentJson}
          publishedAt={entry.publishedAt}
          linkedPosts={entry.linkedPosts}
        />
      </div>
    </div>
  )
}

function ChangelogNotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-bold mb-2">Changelog entry not found</h1>
      <p className="text-muted-foreground mb-6">
        This entry may have been removed or is not yet published.
      </p>
      <BackLink to="/changelog">Changelog</BackLink>
    </div>
  )
}
