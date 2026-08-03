/**
 * Teams settings route — list workspace teams + create dialog.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { Suspense } from 'react'
import { teamQueries } from '@/lib/client/queries/teams'
import { TeamList } from '@/components/admin/settings/teams/team-list'
import { TeamCreateDialog } from '@/components/admin/settings/teams/team-create-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PlusIcon } from '@heroicons/react/24/solid'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export const Route = createFileRoute('/admin/settings/teams')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(teamQueries.list({ includeArchived: true }))
  },
  errorComponent: createRouteErrorComponent('Failed to load teams'),
  component: TeamsSettingsPage,
})

function TeamsSettingsPage() {
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Teams</h1>
          <p className="text-sm text-muted-foreground">
            Workspace teams used for routing, ticket sharing, and SLA scopes.
          </p>
        </div>
        <PermissionGate permission={PERMISSIONS.ADMIN_MANAGE_USERS}>
          <TeamCreateDialog
            trigger={
              <Button size="sm">
                <PlusIcon className="h-4 w-4 mr-1" />
                New team
              </Button>
            }
          />
        </PermissionGate>
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <TeamList />
      </Suspense>
    </div>
  )
}
