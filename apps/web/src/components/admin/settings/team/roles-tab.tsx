import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { useHasPermission } from '@/lib/client/use-permissions'
import { settingsQueries } from '@/lib/client/queries/settings'
import { listRolesFn } from '@/lib/server/functions/roles'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { CUSTOM_ROLE_BADGE, CUSTOM_ROLE_NOTICE } from './role-ui'

type RolesPayload = Awaited<ReturnType<typeof listRolesFn>>
type RoleWithMeta = RolesPayload['roles'][number]

/**
 * Roles tab — a card grid over the roles table. Every card is a link to the
 * role's detail page: custom roles open the editor, presets (and any role for
 * a viewer without role.manage) open read-only. Creating and duplicating both
 * route to /roles/new; there are no per-card action buttons. Write affordances
 * gate on role.manage (render-only; the server enforces).
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
      description="Built-in roles are read-only — duplicate one to customize it. Custom roles grant any mix of permissions you hold yourself."
      action={
        canManage ? (
          <Button
            size="sm"
            disabled={capReached}
            onClick={() => navigate({ to: '/admin/settings/members/roles/new' })}
          >
            New role
          </Button>
        ) : undefined
      }
      contentClassName="space-y-4"
    >
      {maxCustomRoles != null && (
        <div className={cn('rounded-lg border px-3.5 py-2.5 text-[13px]', CUSTOM_ROLE_NOTICE)}>
          <strong>
            {customCount} of {maxCustomRoles}
          </strong>{' '}
          custom role{maxCustomRoles === 1 ? '' : 's'} used.
          {capReached && ' Your plan is at its custom-role limit.'}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} />
        ))}
        {canManage && !capReached && (
          <Link
            to="/admin/settings/members/roles/new"
            className="flex min-h-[7.5rem] items-center justify-center rounded-xl border-[1.5px] border-dashed text-xs font-semibold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            + New role
          </Link>
        )}
      </div>
    </SettingsCard>
  )
}

function RoleCard({ role }: { role: RoleWithMeta }) {
  return (
    <Link
      to="/admin/settings/members/roles/$roleId"
      params={{ roleId: role.id }}
      className="group flex min-h-[7.5rem] flex-col rounded-xl border bg-card p-4 shadow-sm transition hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate text-sm font-semibold">{role.name}</span>
        <Badge
          size="sm"
          variant={role.isSystem ? 'subtle' : 'outline'}
          className={cn('shrink-0', !role.isSystem && CUSTOM_ROLE_BADGE)}
        >
          {role.isSystem ? 'Preset' : 'Custom'}
        </Badge>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
        {role.description || (role.isSystem ? 'Built-in role' : 'Custom role')}
      </p>
      <div className="mt-auto flex items-center justify-between pt-3">
        <span className="font-mono text-[11px] text-muted-foreground/80">
          {role.permissionKeys.length} permissions
          {!role.isSystem && (
            <>
              {' · '}
              {role.memberCount} member{role.memberCount === 1 ? '' : 's'}
            </>
          )}
          {role.newPermissionKeys.length > 0 && (
            <>
              {' · '}
              <span className="font-semibold text-foreground/70">
                {role.newPermissionKeys.length} new
              </span>
            </>
          )}
        </span>
        <ArrowRightIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition group-hover:translate-x-0.5 group-hover:text-foreground/60" />
      </div>
    </Link>
  )
}
