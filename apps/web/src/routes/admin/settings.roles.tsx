/**
 * Roles & permissions admin route.
 * Gated server-side by `requireAuth({ roles: ['admin'] })`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Suspense } from 'react'
import { listRolesFn } from '@/lib/server/functions/roles'
import { RolesSettings } from '@/components/admin/settings/roles/roles-settings'
import { Skeleton } from '@/components/ui/skeleton'

const rolesListQuery = () => ({
  queryKey: ['admin', 'roles', 'list'] as const,
  queryFn: () => listRolesFn(),
})

export const Route = createFileRoute('/admin/settings/roles')({
  loader: async ({ context }) => {
    const { queryClient } = context as {
      queryClient: import('@tanstack/react-query').QueryClient
    }
    await queryClient.ensureQueryData(rolesListQuery())
  },
  errorComponent: createRouteErrorComponent('Failed to load roles'),
  component: RolesPage,
})

function RolesPage() {
  return (
    <div className="space-y-4 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold">Roles &amp; permissions</h1>
        <p className="text-xs text-muted-foreground">
          Manage role bundles and the permissions they grant. System roles (lock icon) are seeded by
          the platform and cannot be edited.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <RolesSettingsLoader />
      </Suspense>
    </div>
  )
}

function RolesSettingsLoader() {
  const { data } = useSuspenseQuery(rolesListQuery())
  return <RolesSettings roles={data} />
}
