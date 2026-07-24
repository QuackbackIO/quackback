import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery, useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { inboxPostsInfiniteOptions, defaultInboxFilters } from '@/lib/client/hooks/use-inbox-query'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import { InboxContainer } from '@/components/admin/feedback/inbox-container'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ExclamationCircleIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'

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
      queryClient,
    } = context as {
      user: NonNullable<typeof context.user>
      principal: NonNullable<typeof context.principal>
      queryClient: typeof context.queryClient
    }

    // Pre-fetch all data in parallel using React Query. The posts query only
    // ever prefetches the default/initial (unfiltered) dataset — a filtered
    // URL on first load falls through to InboxContainer's own client fetch,
    // same as the portal feed.
    await Promise.all([
      // Warm the SAME infinite cache the renderer reads (QC-1): one shared
      // query definition, so mutations invalidating inboxKeys.lists() reach the
      // cache the UI actually renders. Only the default/unfiltered dataset is
      // prefetched; a filtered URL on first load falls through to the client
      // fetch inside InboxContainer.
      queryClient.ensureInfiniteQueryData(inboxPostsInfiniteOptions(defaultInboxFilters)),
      queryClient.ensureQueryData(adminQueries.boards()),
      queryClient.ensureQueryData(adminQueries.tags()),
      queryClient.ensureQueryData(adminQueries.statuses()),
      queryClient.ensureQueryData(adminQueries.teamMembers()),
      queryClient.ensureQueryData(mergeSuggestionQueries.summary()),
      // Warm the moderation count so the pending-moderation banner renders on
      // first paint instead of popping in once the query resolves.
      queryClient.ensureQueryData(adminQueries.moderationStatus()),
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
