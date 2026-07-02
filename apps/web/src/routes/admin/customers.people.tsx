import { Suspense, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { adminQueries } from '@/lib/client/queries/admin'
import { CustomerPeopleTable } from '@/components/admin/customers/customer-people-table'
import { ContactCreateDialog } from '@/components/admin/contacts/contact-create-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { PlusIcon } from '@heroicons/react/24/solid'

export const Route = createFileRoute('/admin/customers/people')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(
      adminQueries.customerPeople({ includeArchived: false, limit: 100 })
    )
  },
  errorComponent: createRouteErrorComponent('Failed to load people'),
  component: CustomerPeoplePage,
})

function CustomerPeoplePage() {
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search people..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="customers-show-archived"
              checked={showArchived}
              onCheckedChange={setShowArchived}
            />
            <Label htmlFor="customers-show-archived" className="text-xs font-normal">
              Show archived
            </Label>
          </div>
          <PermissionGate permission={PERMISSIONS.ORG_MANAGE}>
            <ContactCreateDialog
              trigger={
                <Button size="sm">
                  <PlusIcon className="mr-1 h-4 w-4" />
                  New contact
                </Button>
              }
            />
          </PermissionGate>
        </div>
      </div>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <CustomerPeopleTable search={search} showArchived={showArchived} />
      </Suspense>
    </div>
  )
}
