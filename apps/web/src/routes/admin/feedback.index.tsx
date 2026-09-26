import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { warmFeedbackPage } from '@/lib/client/queries/feedback-page'
import { InboxContainer } from '@/components/admin/feedback/inbox-container'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/components/shared/error-page'

export const Route = createFileRoute('/admin/feedback/')({
  // Note: No loaderDeps for the filter fields - the loader only runs on
  // initial route load for SSR (prefetching the default/unfiltered dataset).
  // Client-side filter changes are handled by InboxContainer's useInboxPosts
  // (combined with its placeholderData) instead of re-running this loader —
  // mirrors the documented pattern in src/routes/_portal/index.tsx.
  errorComponent: FeedbackErrorComponent,
  loader: async ({ context }) => {
    // Protected route - user and principal are guaranteed by parent's beforeLoad auth check
    const {
      user: currentUser,
      principal,
      permissions,
      queryClient,
    } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      permissions: NonNullable<typeof context.permissions>
      queryClient: typeof context.queryClient
    }

    // Awaited so the document hydrates instead of racing a fire-and-forget
    // prefetch.
    await warmFeedbackPage(queryClient, permissions)

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

function FeedbackErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const message = errorMessage(error)
  return (
    <div className="flex items-center justify-center min-h-[400px] p-4">
      <Alert variant="destructive" className="max-w-2xl">
        <ExclamationCircleIcon className="h-4 w-4" />
        <AlertTitle>Failed to load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p className="mb-4">{message}</p>
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

  // Read pre-fetched reference data from React Query cache. The posts list is
  // read directly by InboxContainer's own infinite `useInboxPosts` hook — which
  // shares its query definition with the loader's prefetch (QC-1) — so there's
  // no separate suspense query for posts here.
  const boardsQuery = useSuspenseQuery(adminQueries.boards())
  const tagsQuery = useSuspenseQuery(adminQueries.tags())
  const statusesQuery = useSuspenseQuery(adminQueries.statuses())
  const membersQuery = useQuery(adminQueries.teamMembers())

  return (
    <InboxContainer
      boards={boardsQuery.data}
      tags={tagsQuery.data}
      statuses={statusesQuery.data}
      members={membersQuery.data ?? []}
      currentUser={currentUser}
    />
  )
}
