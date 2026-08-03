/**
 * Business hours admin route. Lists calendars and opens the create/edit
 * dialog. Used as the `businessHoursId` reference on SLA policies.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { Suspense, useState } from 'react'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { BusinessHoursList } from '@/components/admin/settings/sla/business-hours-list'
import { BusinessHoursDialog } from '@/components/admin/settings/sla/business-hours-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PlusIcon } from '@heroicons/react/24/solid'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export const Route = createFileRoute('/admin/settings/business-hours')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(businessHoursQueries.list({ includeArchived: true }))
  },
  errorComponent: createRouteErrorComponent('Failed to load business hours'),
  component: BusinessHoursPage,
})

function BusinessHoursPage() {
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Business hours</h1>
          <p className="text-sm text-muted-foreground">
            Calendars define working hours and holidays. Used by SLA policies to compute due times.
          </p>
        </div>
        <PermissionGate permission={PERMISSIONS.BUSINESS_HOURS_MANAGE}>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-4 w-4 mr-1" />
            New calendar
          </Button>
        </PermissionGate>
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <BusinessHoursList />
      </Suspense>

      <BusinessHoursDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
