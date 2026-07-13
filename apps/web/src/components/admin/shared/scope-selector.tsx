/**
 * `<ScopeSelector />` — workspace | team | inbox toggle reused by SLA and
 * routing-rule editors.
 */
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/shared/utils'
import { TeamPicker } from './team-picker'
import { InboxPicker } from './inbox-picker'
import type { TeamId, InboxId } from '@quackback/ids'

export type ScopeKind = 'workspace' | 'team' | 'inbox'

export interface ScopeValue {
  kind: ScopeKind
  teamId?: TeamId | null
  inboxId?: InboxId | null
}

interface Props {
  value: ScopeValue
  onValueChange: (value: ScopeValue) => void
  /** Restrict the toggleable kinds (e.g. omit 'inbox' for routing rules). */
  allowedKinds?: ScopeKind[]
  disabled?: boolean
  className?: string
}

export function ScopeSelector({
  value,
  onValueChange,
  allowedKinds = ['workspace', 'team', 'inbox'],
  disabled,
  className,
}: Props) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="inline-flex rounded-md border bg-background p-0.5">
        {allowedKinds.map((kind) => (
          <Button
            key={kind}
            type="button"
            variant={value.kind === kind ? 'secondary' : 'ghost'}
            size="sm"
            disabled={disabled}
            className="capitalize"
            onClick={() => onValueChange({ kind, teamId: null, inboxId: null })}
          >
            {kind}
          </Button>
        ))}
      </div>
      {value.kind === 'team' && (
        <TeamPicker
          value={value.teamId ?? null}
          onValueChange={(teamId) => onValueChange({ kind: 'team', teamId, inboxId: null })}
          disabled={disabled}
        />
      )}
      {value.kind === 'inbox' && (
        <InboxPicker
          value={value.inboxId ?? null}
          onValueChange={(inboxId) => onValueChange({ kind: 'inbox', teamId: null, inboxId })}
          disabled={disabled}
        />
      )}
    </div>
  )
}
