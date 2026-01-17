import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'
import { FeedbackContainer } from '@/components/public/feedback/feedback-container'
import { getUserIdentifier, getMemberIdentifier } from '@/lib/user-identifier'
import { portalQueries } from '@/lib/queries/portal'
import { getMemberIdForUser } from '@/lib/server-functions/portal'

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

    let userIdentifier = await getUserIdentifier()
    if (session?.user) {
      const memberId = await getMemberIdForUser({ data: { userId: session.user.id } })
      if (memberId) {
        userIdentifier = getMemberIdentifier(memberId)
      }
    }

    const [boards, posts] = await Promise.all([
      queryClient.ensureQueryData(portalQueries.boards()),
      queryClient.ensureQueryData(
        portalQueries.posts({ boardSlug: board, search: searchQuery, sort })
      ),
      queryClient.ensureQueryData(portalQueries.statuses()),
      queryClient.ensureQueryData(portalQueries.tags()),
    ])

    if (boards.length === 0) {
      return {
        org,
        isEmpty: true as const,
        currentBoard: undefined,
        currentSearch: undefined,
        currentSort: sort,
        session,
        userIdentifier,
        postIds: [],
        postMemberIds: [],
      }
    }

    const postIds = posts.items.map((post) => post.id)
    const postMemberIds = posts.items
      .map((post) => post.memberId)
      .filter((id): id is `member_${string}` => id !== null)

    await Promise.all([
      queryClient.ensureQueryData(portalQueries.votedPosts(postIds, userIdentifier)),
      postMemberIds.length > 0
        ? queryClient.ensureQueryData(portalQueries.avatars(postMemberIds))
        : Promise.resolve(),
    ])

    return {
      org,
      isEmpty: false as const,
      currentBoard: board,
      currentSearch: searchQuery,
      currentSort: sort,
      session,
      userIdentifier,
      postIds,
      postMemberIds,
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

  const { currentBoard, currentSearch, currentSort, userIdentifier, postIds, postMemberIds } =
    loaderData

  const boardsQuery = useSuspenseQuery(portalQueries.boards())
  const postsQuery = useSuspenseQuery(
    portalQueries.posts({ boardSlug: currentBoard, search: currentSearch, sort: currentSort })
  )
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())
  const tagsQuery = useSuspenseQuery(portalQueries.tags())
  const votedPostsQuery = useSuspenseQuery(portalQueries.votedPosts(postIds, userIdentifier))
  const avatarsQuery = useSuspenseQuery(portalQueries.avatars(postMemberIds))

  const user = session?.user ? { name: session.user.name, email: session.user.email } : null

  return (
    <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
      <FeedbackContainer
        workspaceName={org.name}
        workspaceSlug={org.slug}
        boards={boardsQuery.data}
        posts={postsQuery.data.items as any}
        statuses={statusesQuery.data}
        tags={tagsQuery.data}
        hasMore={postsQuery.data.hasMore}
        votedPostIds={votedPostsQuery.data}
        postAvatarUrls={avatarsQuery.data}
        currentBoard={currentBoard}
        currentSearch={currentSearch}
        currentSort={currentSort}
        defaultBoardId={boardsQuery.data[0]?.id}
        user={user}
      />
    </main>
  )
}
