import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { z } from 'zod'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { portalQueries } from '@/lib/queries/portal'

const searchSchema = z.object({
  board: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['top', 'new', 'trending']).optional().default('top'),
  status: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
})

export const Route = createFileRoute('/_portal/')({
  validateSearch: searchSchema,
  // Note: No loaderDeps - loader only runs on initial route load for SSR.
  // Client-side filter changes are handled by FeedbackContainer's usePublicPosts.
  // We access search params via location.search for initial SSR without triggering
  // loader re-execution on client-side filter changes.
  loader: async ({ context, location }) => {
    const { session, settings: org, queryClient } = context

    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    // Parse search params for initial SSR (not using loaderDeps to avoid re-execution)
    const searchParams = location.search as z.infer<typeof searchSchema>

    // Prefetch portal data for SSR with URL filters.
    // User identifier is read from cookie directly in the server function.
    // Client-side filter changes are handled by FeedbackContainer.
    const portalData = await queryClient.ensureQueryData(
      portalQueries.portalData({
        boardSlug: searchParams.board,
        search: searchParams.search,
        sort: searchParams.sort ?? 'top',
        userId: session?.user?.id,
      })
    )

    return {
      org,
      isEmpty: portalData.boards.length === 0,
      session,
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const loaderData = Route.useLoaderData()
  const search = Route.useSearch()
  const { org, session } = loaderData

  // Read filters directly from URL for instant updates
  const currentBoard = search.board
  const currentSearch = search.search
  const currentSort = search.sort ?? 'top'

  // Fetch portal data - uses cached data from loader on initial load,
  // refetches with new filters on client-side navigation.
  // keepPreviousData ensures we show stale data while fetching new data.
  // User identifier is read from cookie directly in the server function.
  const { data: portalData, isFetching } = useQuery({
    ...portalQueries.portalData({
      boardSlug: currentBoard,
      search: currentSearch,
      sort: currentSort,
      userId: session?.user?.id,
    }),
    placeholderData: keepPreviousData,
  })

  // Show empty state if no boards exist
  if (loaderData.isEmpty && !isFetching && (!portalData || portalData.boards.length === 0)) {
    return (
      <main className="py-6">
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
          <div className="rounded-full bg-muted p-4 mb-6">
            <ChatBubbleOvalLeftEllipsisIcon className="h-10 w-10 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">Coming Soon</h2>
          <p className="text-muted-foreground max-w-md">
            {org.name} is setting up their feedback portal. Check back soon to share your ideas and
            suggestions.
          </p>
        </div>
      </main>
    )
  }

  // Handle initial loading state (should be rare due to SSR)
  if (!portalData) {
    return (
      <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
        <div className="flex justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </main>
    )
  }

  const user = session?.user ? { name: session.user.name, email: session.user.email } : null

  return (
    <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
      <FeedbackContainer
        workspaceName={org.name}
        workspaceSlug={org.slug}
        boards={portalData.boards}
        posts={portalData.posts.items}
        statuses={portalData.statuses}
        tags={portalData.tags}
        hasMore={portalData.posts.hasMore}
        votedPostIds={portalData.votedPostIds}
        postAvatarUrls={portalData.avatars}
        currentBoard={currentBoard}
        currentSearch={currentSearch}
        currentSort={currentSort}
        defaultBoardId={portalData.boards[0]?.id}
        user={user}
      />
    </main>
  )
}
