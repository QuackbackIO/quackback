import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { assertSettingsPageAccess } from '@/lib/shared/settings-page-access'
import { settingsQueries } from '@/lib/client/queries/settings'
import { RoleEditor } from '@/components/admin/settings/team/role-editor'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/members_/roles/new')({
  head: adminPageHead('New role'),
  // `?from=<roleId>` preselects a duplicate source (the Duplicate action).
  validateSearch: z.object({ from: z.string().optional() }),
  beforeLoad: ({ context }) => {
    assertSettingsPageAccess(context.permissions, '/admin/settings/members/roles/new')
  },
  // The editor starts from the roles list (permission presets, a duplicate's source).
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(settingsQueries.roles())
  },
  component: NewRolePage,
})

function NewRolePage() {
  const { from } = Route.useSearch()
  return <RoleEditor key={from ?? 'blank'} mode="create" duplicateFromId={from} />
}
