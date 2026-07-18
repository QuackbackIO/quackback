import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { RoleEditor } from '@/components/admin/settings/team/role-editor'

export const Route = createFileRoute('/admin/settings/members_/roles/$roleId')({
  beforeLoad: async () => {
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({
      data: { allowedRoles: ['admin', 'member'], permission: PERMISSIONS.ROLE_MANAGE },
    })
  },
  component: RoleEditorPage,
})

function RoleEditorPage() {
  const { roleId } = Route.useParams()
  return <RoleEditor key={roleId} roleId={roleId} />
}
