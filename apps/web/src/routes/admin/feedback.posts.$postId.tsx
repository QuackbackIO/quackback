import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/queries/admin'
import { FeedbackDetailPage } from '@/components/admin/feedback/detail/feedback-detail-page'
import { ensureTypeId, type PostId } from '@quackback/ids'
import type { PostDetails } from '@/components/admin/feedback/inbox-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/admin/feedback/posts/$postId')({
  errorComponent: DetailErrorComponent,
  loader: async ({ params, context }) => {
    const { postId } = params
    // Protected route - user and member are guaranteed by parent's beforeLoad auth check
    const {
      user: currentUser,
      member,
      queryClient,
    } = context as {
      user: NonNullable<typeof context.user>
      member: NonNullable<typeof context.member>
      queryClient: typeof context.queryClient
    }

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
      queryClient.ensureQueryData(adminQueries.roadmaps()),
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

function FeedbackDetailRoute(): React.ReactElement {
  const { postId, currentUser } = Route.useLoaderData()

  const postQuery = useSuspenseQuery(adminQueries.postDetail(postId))
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const roadmapsQuery = useSuspenseQuery(adminQueries.roadmaps())

  return (
    <FeedbackDetailPage
      post={postQuery.data as PostDetails}
      boards={boardsQuery.data}
      tags={tagsQuery.data}
      statuses={statusesQuery.data}
      roadmaps={roadmapsQuery.data}
      currentUser={currentUser}
    />
  )
}
