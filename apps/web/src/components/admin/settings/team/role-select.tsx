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
import type { RoleChoice } from '@/components/admin/settings/team/add-people'

/**
 * The role picked in a team role select: 'member', 'admin', or a custom
 * role's id. Resolves it to what the server takes plus its display name.
 */
export function useRoleChoice(value: string): RoleChoice {
  const { data } = useQuery(settingsQueries.roles())
  if (value === 'admin') return { role: 'admin', label: 'Admin' }
  if (value === 'member') return { role: 'member', label: 'Member' }
  const custom = (data?.roles ?? []).find((r) => r.id === value)
  return { role: 'member', roleId: value, label: custom?.name ?? 'Member' }
}

/** The select's value for a role the person holds. */
export function roleValueOf(role: { role: 'admin' | 'member'; roleId?: string | null }): string {
  return role.roleId ?? role.role
}

/**
 * Presets (Member, Admin) then any custom roles. Admin is offered only to
 * someone who can grant it; the server refuses it otherwise anyway.
 */
export function RoleSelect({
  id,
  value,
  onValueChange,
  canGrantAdmin,
  invalid,
}: {
  id: string
  value: string
  onValueChange: (value: string) => void
  canGrantAdmin: boolean
  invalid?: boolean
}) {
  const { data } = useQuery(settingsQueries.roles())
  const customRoles = (data?.roles ?? []).filter((r) => !r.isSystem)
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
