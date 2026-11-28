import { createFileRoute } from '@tanstack/react-router'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { settingsQueries } from '@/lib/client/queries/settings'
import { RoleEditor } from '@/components/admin/settings/team/role-editor'
import { seedAdminAreas } from '@/lib/shared/i18n'

export const Route = createFileRoute('/admin/settings/members_/roles/$roleId')({
  // Viewable by anyone who can see the roster; the page renders read-only
  // without role.manage (and always for presets). Editing is enforced by the
  // server on save.
  beforeLoad: ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/members/roles/$roleId')
  },
  // The editor shows the role from the roles list.
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(settingsQueries.roles())
    return seedAdminAreas(context.personLocale, 'adminWorkspaceSettings')
  },
  component: RoleEditorPage,
})

function RoleEditorPage() {
  const { roleId } = Route.useParams()
  return <RoleEditor key={roleId} mode="edit" roleId={roleId} />
}
