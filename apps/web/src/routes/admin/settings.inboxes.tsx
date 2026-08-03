/**
 * Inbox-list settings route. Pre-fetches inboxes (including archived) and
 * renders `<InboxList />` plus a "New inbox" trigger.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { Suspense } from 'react'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { InboxList } from '@/components/admin/settings/inboxes/inbox-list'
import { InboxCreateDialog } from '@/components/admin/settings/inboxes/inbox-create-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PlusIcon } from '@heroicons/react/24/solid'

export const Route = createFileRoute('/admin/settings/inboxes')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(inboxQueries.list({ includeArchived: true }))
  },
  errorComponent: createRouteErrorComponent('Failed to load inboxes'),
  component: InboxesSettingsPage,
})

function InboxesSettingsPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Inboxes</h1>
          <p className="text-sm text-muted-foreground">
            Named queues with channels, members, and routing defaults.
          </p>
        </div>
        <InboxCreateDialog
          trigger={
            <Button size="sm">
              <PlusIcon className="h-4 w-4 mr-1" />
              New inbox
            </Button>
          }
        />
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <InboxList />
      </Suspense>
    </div>
  )
}
