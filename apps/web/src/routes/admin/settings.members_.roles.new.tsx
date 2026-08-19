import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { RoleEditor } from '@/components/admin/settings/team/role-editor'

export const Route = createFileRoute('/admin/settings/members_/roles/new')({
  // `?from=<roleId>` preselects a duplicate source (the Duplicate action).
  validateSearch: z.object({ from: z.string().optional() }),
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.ROLE_MANAGE)
  },
  component: NewRolePage,
})

function NewRolePage() {
  const { from } = Route.useSearch()
  return <RoleEditor key={from ?? 'blank'} mode="create" duplicateFromId={from} />
}
