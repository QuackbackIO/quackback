import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { InboxContainer } from '@/components/admin/feedback/inbox-container'
import { type BoardId, type TagId, type PrincipalId } from '@quackback/ids'
import type { InboxPostListResult } from '@/lib/shared/db-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/admin/feedback/')({
  loaderDeps: ({ search }) => ({
    board: search.board,
    tags: search.tags,
    status: search.status,
    owner: search.owner,
    search: search.search,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    minVotes: search.minVotes,
    sort: search.sort,
  }),
  errorComponent: FeedbackErrorComponent,
  loader: async ({ deps, context }) => {
    // Protected route - user and principal are guaranteed by parent's beforeLoad auth check
    const {
      user: currentUser,
      principal,
      queryClient,
    } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    // Parse filter params
    const boardFilterIds = (deps.board || []) as BoardId[]
    const tagFilterIds = (deps.tags || []) as TagId[]
    const statusFilterSlugs = deps.status || []
    const ownerFilterId = deps.owner

    // Pre-fetch all data in parallel using React Query
    await Promise.all([
      queryClient.ensureQueryData(
        adminQueries.inboxPosts({
          boardIds: boardFilterIds.length > 0 ? boardFilterIds : undefined,
          statusSlugs: statusFilterSlugs.length > 0 ? statusFilterSlugs : undefined,
          tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
          ownerId:
            ownerFilterId === 'unassigned' ? null : (ownerFilterId as PrincipalId | undefined),
          search: deps.search,
          dateFrom: deps.dateFrom ? new Date(deps.dateFrom) : undefined,
          dateTo: deps.dateTo ? new Date(deps.dateTo) : undefined,
          minVotes: deps.minVotes ? parseInt(deps.minVotes, 10) : undefined,
          sort: deps.sort,
          page: 1,
          limit: 20,
        })
      ),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.teamMembers()),
    ])

    return {
      currentUser: {
        name: currentUser.name,
        email: currentUser.email,
        principalId: principal.id,
      },
    }
  },
  component: FeedbackIndexPage,
})

function FeedbackErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>Failed to load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{error.message}</p>
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function FeedbackIndexPage() {
  const { currentUser } = Route.useLoaderData()
  const search = Route.useSearch()

  // Parse filter params
  const boardFilterIds = (search.board || []) as BoardId[]
  const tagFilterIds = (search.tags || []) as TagId[]
  const statusFilterSlugs = search.status || []
  const ownerFilterId = search.owner

  // Read pre-fetched data from React Query cache
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const postsQuery = useSuspenseQuery(
    adminQueries.inboxPosts({
      boardIds: boardFilterIds.length > 0 ? boardFilterIds : undefined,
      statusSlugs: statusFilterSlugs.length > 0 ? statusFilterSlugs : undefined,
      tagIds: tagFilterIds.length > 0 ? tagFilterIds : undefined,
      ownerId: ownerFilterId === 'unassigned' ? null : (ownerFilterId as PrincipalId | undefined),
      search: search.search,
      dateFrom: search.dateFrom ? new Date(search.dateFrom) : undefined,
      dateTo: search.dateTo ? new Date(search.dateTo) : undefined,
      minVotes: search.minVotes ? parseInt(search.minVotes, 10) : undefined,
      sort: search.sort,
      page: 1,
      limit: 20,
    })
  )
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const membersQuery = useSuspenseQuery(adminQueries.teamMembers())

  return (
    <InboxContainer
      initialPosts={postsQuery.data as InboxPostListResult}
      boards={boardsQuery.data}
      tags={tagsQuery.data}
      statuses={statusesQuery.data}
      members={membersQuery.data}
      currentUser={currentUser}
    />
  )
}
