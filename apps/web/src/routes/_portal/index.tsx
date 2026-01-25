import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { getUserIdentifier } from '@/lib/user-identifier'
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
  loaderDeps: ({ search }) => ({
    board: search.board,
    searchQuery: search.search,
    sort: search.sort,
  }),
  loader: async ({ deps, context }) => {
    const { session, settings: org, queryClient } = context

    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    const { board, searchQuery, sort } = deps

    // Get user identifier (cookie-based for anonymous users)
    const userIdentifier = await getUserIdentifier()

    // Single combined query for all portal data
    const portalData = await queryClient.ensureQueryData(
      portalQueries.portalData({
        boardSlug: board,
        search: searchQuery,
        sort,
        userId: session?.user?.id,
        userIdentifier,
      })
    )

    if (portalData.boards.length === 0) {
      return {
        org,
        isEmpty: true as const,
        currentBoard: undefined,
        currentSearch: undefined,
        currentSort: sort,
        session,
        userIdentifier: portalData.userIdentifier,
      }
    }

    return {
      org,
      isEmpty: false as const,
      currentBoard: board,
      currentSearch: searchQuery,
      currentSort: sort,
      session,
      userIdentifier: portalData.userIdentifier,
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const loaderData = Route.useLoaderData()
  const { org, session } = loaderData

  if (loaderData.isEmpty) {
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

  const { currentBoard, currentSearch, currentSort, userIdentifier } = loaderData

  // Single combined query for all portal data
  const { data: portalData } = useSuspenseQuery(
    portalQueries.portalData({
      boardSlug: currentBoard,
      search: currentSearch,
      sort: currentSort,
      userId: session?.user?.id,
      userIdentifier,
    })
  )

  const user = session?.user ? { name: session.user.name, email: session.user.email } : null

  return (
    <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
      <FeedbackContainer
        workspaceName={org.name}
        workspaceSlug={org.slug}
        boards={portalData.boards}
        posts={portalData.posts.items as any}
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
