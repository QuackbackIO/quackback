import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
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

/**
 * Public portal page - shows feedback boards and posts
 * This page is rendered for workspace domain root: acme.quackback.io/
 */
export const Route = createFileRoute('/_portal/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    board: search.board,
    searchQuery: search.search,
    sort: search.sort,
  }),
  loader: async ({ deps, context }) => {
    // Session/settings from context
    const { session, settings: org, queryClient } = context

    // Redirect to onboarding if no settings (fresh install)
    if (!org) {
      throw redirect({ to: '/onboarding' })
    }

    const { board, searchQuery, sort } = deps

    // Get user identifier - use member ID for authenticated users, anonymous cookie for others
    let userIdentifier = await getUserIdentifier()
    if (session?.user) {
      // Use server function to get member ID (keeps db code out of client bundle)
      const memberId = await getMemberIdForUser({ data: { userId: session.user.id } })
      if (memberId) {
        userIdentifier = getMemberIdentifier(memberId)
      }
    }

    // Pre-fetch all portal data using React Query
    const [boards, posts, _statuses, _tags] = await Promise.all([
      queryClient.ensureQueryData(portalQueries.boards()),
      queryClient.ensureQueryData(
        portalQueries.posts({ boardSlug: board, search: searchQuery, sort })
      ),
      queryClient.ensureQueryData(portalQueries.statuses()),
      queryClient.ensureQueryData(portalQueries.tags()),
    ])

    // If no boards exist, redirect to onboarding
    if (boards.length === 0) {
      throw redirect({ to: '/onboarding' })
    }

    // Pre-fetch voted posts and avatars
    const postIds = posts.items.map((p) => p.id)
    const postMemberIds = posts.items
      .map((p) => p.memberId)
      .filter((id): id is `member_${string}` => id !== null)

    await Promise.all([
      queryClient.ensureQueryData(portalQueries.votedPosts(postIds, userIdentifier)),
      postMemberIds.length > 0
        ? queryClient.ensureQueryData(portalQueries.avatars(postMemberIds))
        : Promise.resolve(),
    ])

    // Return metadata needed by component
    return {
      org,
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
  const {
    org,
    currentBoard,
    currentSearch,
    currentSort,
    session,
    userIdentifier,
    postIds,
    postMemberIds,
  } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const boardsQuery = useSuspenseQuery(portalQueries.boards())
  const postsQuery = useSuspenseQuery(
    portalQueries.posts({ boardSlug: currentBoard, search: currentSearch, sort: currentSort })
  )
  const statusesQuery = useSuspenseQuery(portalQueries.statuses())
  const tagsQuery = useSuspenseQuery(portalQueries.tags())
  const votedPostsQuery = useSuspenseQuery(portalQueries.votedPosts(postIds, userIdentifier))
  const avatarsQuery = useSuspenseQuery(portalQueries.avatars(postMemberIds))

  return (
    <main className="mx-auto max-w-5xl w-full flex-1 py-6 sm:px-6 lg:px-8">
      <FeedbackContainer
        workspaceName={org.name}
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
        user={session?.user ? { name: session.user.name, email: session.user.email } : null}
      />
    </main>
  )
}
