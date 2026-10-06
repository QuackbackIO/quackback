import { useQuery } from '@tanstack/react-query'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { settingsQueries } from '@/lib/client/queries/settings'
import { SYSTEM_ROLES } from '@/lib/shared/permissions'
import type { RoleChoice } from '@/components/admin/settings/team/add-people'

/** System roles whose holders sit on the admin tier. */
const ADMIN_TIER_KEYS: ReadonlySet<string> = new Set([SYSTEM_ROLES.OWNER, SYSTEM_ROLES.ADMIN])

/**
 * The role picked in a team role select: 'member', 'admin', or a role's id.
 * Resolves it to what the server takes plus its display name. `held` is the
 * role the person holds now, which the list may not otherwise carry.
 */
export function useRoleChoice(value: string, held?: RoleChoice): RoleChoice {
  const { data } = useQuery(settingsQueries.roles())
  if (held && value === roleValueOf(held)) return held
  if (value === 'admin') return { role: 'admin', label: 'Admin' }
  if (value === 'member') return { role: 'member', label: 'Member' }
  const found = (data?.roles ?? []).find((r) => r.id === value)
  const tier = found?.isSystem && ADMIN_TIER_KEYS.has(found.key) ? 'admin' : 'member'
  return { role: tier, roleId: value, label: found?.name ?? 'Member' }
}

/** The select's value for a role the person holds. */
export function roleValueOf(role: { role: 'admin' | 'member'; roleId?: string | null }): string {
  return role.roleId ?? role.role
}

/**
 * Presets (Member, Admin) then any custom roles. Admin-tier roles are offered
 * only to someone who can grant them; the server refuses them otherwise
 * anyway. A role the person already holds that is neither (another system
 * role, such as Contributor) is listed in its group so the select opens on it.
 */
export function RoleSelect({
  id,
  value,
  onValueChange,
  canGrantAdmin,
  invalid,
  held,
}: {
  id: string
  value: string
  onValueChange: (value: string) => void
  canGrantAdmin: boolean
  invalid?: boolean
  held?: RoleChoice
}) {
  const { data } = useQuery(settingsQueries.roles())
  const customRoles = (data?.roles ?? []).filter((r) => !r.isSystem)
  const heldId = held?.roleId
  const heldExtra =
    heldId && !customRoles.some((r) => r.id === heldId) ? (
      <SelectItem value={heldId} disabled={held.role === 'admin' && !canGrantAdmin}>
        {data?.roles.find((r) => r.id === heldId)?.name ?? held.label}
      </SelectItem>
    ) : null
  return (
    <Select value={value} onValueChange={(v: string) => onValueChange(v)}>
      <SelectTrigger id={id} className="w-full sm:w-[330px]" aria-invalid={invalid || undefined}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Presets</SelectLabel>
          <SelectItem value="member">Member - Can view and create feedback</SelectItem>
          <SelectItem value="admin" disabled={!canGrantAdmin}>
            Admin - Can manage settings and members
          </SelectItem>
          {heldExtra}
        </SelectGroup>
        {customRoles.length > 0 && (
          <SelectGroup>
            <SelectLabel>Custom</SelectLabel>
            {customRoles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

/** The one-line consequence under the select, and a refused grant from the server. */
export function RoleNotes({ role, refused }: { role: RoleChoice; refused: boolean }) {
  if (refused) {
    return (
      <p role="alert" className="text-xs text-destructive">
        You can only give a role with no more access than your own. Choose another role.
      </p>
    )
  }
  if (role.role === 'admin') {
    return (
      <p className="text-xs text-warning">
        Admins can change settings, billing, members and sign-in.
      </p>
    )
  }
  return null
}
