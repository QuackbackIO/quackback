import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/queries/admin'
import { FeedbackDetailPage } from '@/components/admin/feedback/detail/feedback-detail-page'
import { ensureTypeId, type PostId } from '@quackback/ids'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/admin/feedback/posts/$postId')({
  errorComponent: DetailErrorComponent,
  loader: async ({ params, context }) => {
    const { postId } = params
    const { user: currentUser, member, queryClient } = context

    // Validate TypeID format
    let validatedPostId: PostId
    try {
      validatedPostId = ensureTypeId(postId, 'post')
    } catch {
      throw new Error('Invalid post ID format')
    }

    // Pre-fetch all required data
    await Promise.all([
      queryClient.ensureQueryData(adminQueries.postDetail(validatedPostId)),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.teamMembers()),
    ])

    return {
      postId: validatedPostId,
      currentUser: {
        name: currentUser.name,
        email: currentUser.email,
        memberId: member.id,
      },
    }
  },
  component: FeedbackDetailRoute,
})

function DetailErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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

function FeedbackDetailRoute() {
  const { postId, currentUser } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const membersQuery = useSuspenseQuery(adminQueries.teamMembers())

  return (
    <FeedbackDetailPage
      post={postQuery.data as any}
      boards={boardsQuery.data as any}
      tags={tagsQuery.data}
      statuses={statusesQuery.data}
      members={membersQuery.data}
      currentUser={currentUser}
    />
  )
}
