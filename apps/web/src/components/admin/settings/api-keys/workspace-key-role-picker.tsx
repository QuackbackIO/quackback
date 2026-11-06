import { defineMessages, useIntl } from 'react-intl'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { WorkspaceKeyRoleOption } from '@/lib/server/domains/api-keys/api-key.types'
import { cn } from '@/lib/shared/utils'

const m = defineMessages({
  highImpact: { id: 'apiKeys.highImpact', defaultMessage: 'High impact' },
  customRole: { id: 'apiKeys.workspace.customRole', defaultMessage: 'Custom role' },
  ceiling: {
    id: 'apiKeys.workspace.roleCeiling',
    defaultMessage: 'You can only pick roles whose permissions you hold.',
  },
})

/**
 * The workspace roles as a list of choices. Roles the caller cannot grant are
 * greyed out; roles that can change settings or members say "High impact".
 */
export function WorkspaceKeyRolePicker({
  roles,
  value,
  onChange,
  disabled,
}: {
  roles: readonly WorkspaceKeyRoleOption[]
  value: string
  onChange: (roleId: string) => void
  disabled?: boolean
}) {
  const intl = useIntl()
  const anyBlocked = roles.some((r) => !r.grantable)
  return (
    <div className="space-y-2">
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(String(next))}
        disabled={disabled}
        className="gap-0 overflow-hidden rounded-lg border border-border/50"
      >
        {roles.map((role, i) => (
          <label
            key={role.id}
            className={cn(
              'flex items-center gap-3 px-3 py-2 text-sm',
              i > 0 && 'border-t border-border/30',
              role.grantable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
            )}
          >
            <RadioGroupItem value={role.id} disabled={!role.grantable} aria-label={role.name} />
            <span className="flex-1 truncate">{role.name}</span>
            {role.highImpact && (
              <Badge variant="warning" size="sm">
                {intl.formatMessage(m.highImpact)}
              </Badge>
            )}
            {!role.isSystem && (
              <Badge variant="subtle" size="sm">
                {intl.formatMessage(m.customRole)}
              </Badge>
            )}
          </label>
        ))}
      </RadioGroup>
      {anyBlocked && (
        <p className="text-xs text-muted-foreground">{intl.formatMessage(m.ceiling)}</p>
      )}
    </div>
  )
}
