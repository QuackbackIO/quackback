import { createFileRoute } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { RoleEditor } from '@/components/admin/settings/team/role-editor'

export const Route = createFileRoute('/admin/settings/members_/roles/$roleId')({
  // Viewable by anyone who can see the roster; the page renders read-only
  // without role.manage (and always for presets). Editing is enforced by the
  // server on save.
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.MEMBER_VIEW)
  },
  component: RoleEditorPage,
})

function RoleEditorPage() {
  const { roleId } = Route.useParams()
  return <RoleEditor key={roleId} mode="edit" roleId={roleId} />
}
