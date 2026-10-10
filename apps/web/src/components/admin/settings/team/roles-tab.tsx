import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useHasPermission } from '@/lib/client/use-permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { listRolesFn } from '@/lib/server/functions/roles'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { NewButton } from '@/components/shared/new-button'
import { cn } from '@/lib/shared/utils'
import { CUSTOM_ROLE_NOTICE } from './role-ui'

type RolesPayload = Awaited<ReturnType<typeof listRolesFn>>
type RoleWithMeta = RolesPayload['roles'][number]

/**
 * Roles tab: a list over the roles table. Every row is a link to the role's
 * detail page: custom roles open the editor, presets (and any role for a
 * viewer without role.manage) open read-only. Creating and duplicating both
 * route to /roles/new. Write affordances gate on role.manage (render-only; the
 * server enforces).
 */
export function RolesTab() {
  const { data } = useSuspenseQuery(settingsQueries.roles())
  const { roles, maxCustomRoles } = data
  const canManage = useHasPermission(PERMISSIONS.ROLE_MANAGE)
  const navigate = useNavigate()

  const customCount = roles.filter((r) => !r.isSystem).length
  const capReached = maxCustomRoles != null && customCount >= maxCustomRoles

  return (
    <SettingsCard
      title="Roles"
      description="Built-in roles are read-only. Duplicate one to customize it."
      action={
        canManage ? (
          <NewButton
            noun="role"
            disabled={capReached}
            onClick={() => navigate({ to: '/admin/settings/members/roles/new' })}
          />
        ) : undefined
      }
      flush
    >
      {maxCustomRoles != null && (
        <div className="px-4 pt-4 sm:px-6">
          <div className={cn('rounded-lg border px-3.5 py-2.5 text-[13px]', CUSTOM_ROLE_NOTICE)}>
            <strong>
              {customCount} of {maxCustomRoles}
            </strong>{' '}
            custom role{maxCustomRoles === 1 ? '' : 's'} used.
            {capReached && ' Your plan is at its custom-role limit.'}
          </div>
        </div>
      )}

      <SettingsList>
        {roles.map((role) => (
          <RoleRow key={role.id} role={role} />
        ))}
      </SettingsList>
    </SettingsCard>
  )
}

function RoleRow({ role }: { role: RoleWithMeta }) {
  const meta = [
    role.description?.trim() || null,
    `${role.permissionKeys.length} permissions`,
    !role.isSystem && `${role.memberCount} member${role.memberCount === 1 ? '' : 's'}`,
    role.newPermissionKeys.length > 0 && `${role.newPermissionKeys.length} new`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <SettingsListRow
      to="/admin/settings/members/roles/$roleId"
      params={{ roleId: role.id }}
      title={role.name}
      meta={meta}
    />
  )
}
