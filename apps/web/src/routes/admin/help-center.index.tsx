import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterList } from '@/components/admin/help-center/help-center-list'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { helpCenterSearchSchema } from '@/components/admin/help-center/help-center-search'

export const Route = createFileRoute('/admin/help-center/')({
  loader: async ({ context, location }) => {
    const { queryClient } = context
    // The article list the URL opens, read the way the finder reads it. The
    // deleted-items and performance views read other lists.
    const parsed = helpCenterSearchSchema.safeParse(location.search)
    const search = parsed.success ? parsed.data : null
    const articles =
      search && !search.deleted && !search.performance
        ? queryClient
            .ensureInfiniteQueryData(
              helpCenterQueries.articleList({
                categoryId: search.category,
                status: search.status,
                search: search.search,
                sort: search.sort ?? 'newest',
              })
            )
            .catch(() => undefined)
        : undefined
    // Warm categories so the finder's category list renders real data on
    // first paint instead of flipping from its empty-array default.
    await Promise.all([queryClient.ensureQueryData(helpCenterQueries.categories()), articles])
    return {}
  },
  component: HelpCenterIndexPage,
})

function HelpCenterIndexPage() {
  return (
    <main className="h-full">
      <HelpCenterList />
    </main>
  )
}
