/**
 * SLA policies list route.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { Suspense, useState } from 'react'
import { slaQueries } from '@/lib/client/queries/sla'
import { businessHoursQueries } from '@/lib/client/queries/business-hours'
import { SlaPolicyList } from '@/components/admin/settings/sla/sla-policy-list'
import { SlaPolicyCreateDialog } from '@/components/admin/settings/sla/sla-policy-create-dialog'
import { SlaTickTrigger } from '@/components/admin/settings/sla/sla-tick-trigger'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PlusIcon } from '@heroicons/react/24/solid'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'

export const Route = createFileRoute('/admin/settings/sla')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await Promise.all([
      queryClient.ensureQueryData(slaQueries.policies({ includeArchived: true })),
      queryClient.ensureQueryData(businessHoursQueries.list({})),
    ])
  },
  errorComponent: createRouteErrorComponent('Failed to load SLA policies'),
  component: SlaPoliciesPage,
})

function SlaPoliciesPage() {
  const [createOpen, setCreateOpen] = useState(false)
  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">SLA policies</h1>
          <p className="text-sm text-muted-foreground">
            Service-level targets and escalations applied to tickets by scope and priority.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SlaTickTrigger />
          <PermissionGate permission={PERMISSIONS.SLA_MANAGE}>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-1" />
              New policy
            </Button>
          </PermissionGate>
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <SlaPolicyList />
      </Suspense>

      <SlaPolicyCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
