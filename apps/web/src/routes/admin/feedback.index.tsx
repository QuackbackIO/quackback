import { createFileRoute } from '@tanstack/react-router'
import {
  useAdminBoards,
  useAdminStatuses,
  useAdminTags,
  useAdminTeamMembers,
} from '@/lib/client/hooks/use-admin-catalogues'
import { warmFeedbackPage } from '@/lib/client/queries/feedback-page'
import { InboxContainer } from '@/components/admin/feedback/inbox-container'
import { FeedbackLoadError } from '@/components/admin/feedback/feedback-load-error'
import { adminPageHead } from '@/lib/client/admin-head'
import { AdminPageGate } from '@/components/admin/admin-page-gate'
import { canOpenAdminPage } from '@/lib/shared/admin-page-access'

export const Route = createFileRoute('/admin/feedback/')({
  head: adminPageHead('Feedback'),
  // Note: No loaderDeps for the filter fields - the loader only runs on
  // initial route load for SSR (prefetching the default/unfiltered dataset).
  // Client-side filter changes are handled by InboxContainer's useInboxPosts
  // (combined with its placeholderData) instead of re-running this loader —
  // mirrors the documented pattern in src/routes/_portal/index.tsx.
  errorComponent: FeedbackLoadError,
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
    // prefetch. A viewer who cannot read posts gets the no-access state and
    // no reads.
    if (canOpenAdminPage(permissions, '/admin/feedback')) {
      await warmFeedbackPage(queryClient, permissions)
    }

    return {
      currentUser: {
        name: currentUser.name,
        email: currentUser.email,
        principalId: principal.id,
      },
    }
  },
  component: () => (
    <AdminPageGate page="/admin/feedback">
      <FeedbackIndexPage />
    </AdminPageGate>
  ),
})

function FeedbackIndexPage() {
  const { currentUser } = Route.useLoaderData()

  // Read pre-fetched reference data from React Query cache. The posts list is
  // read directly by InboxContainer's own infinite `useInboxPosts` hook — which
  // shares its query definition with the loader's prefetch (QC-1) — so there's
  // no separate suspense query for posts here. Each list needs a permission of
  // its own: a viewer without it gets an empty list, not a refused request.
  const boardsQuery = useAdminBoards()
  const tagsQuery = useAdminTags()
  const statusesQuery = useAdminStatuses()
  const membersQuery = useAdminTeamMembers()

  return (
    <InboxContainer
      boards={boardsQuery.data ?? []}
      tags={tagsQuery.data ?? []}
      statuses={statusesQuery.data ?? []}
      members={membersQuery.data ?? []}
      currentUser={currentUser}
    />
  )
}
