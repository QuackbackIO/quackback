import {
  ACCESS_DOMAINS,
  toggleDomainLevel,
  type AccessDomainId,
  type DomainAccessChip,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import { cn } from '@/lib/shared/utils'

function AccessChip({
  name,
  display,
  pressed,
  onPressedChange,
  disabled,
}: {
  name: string
  display: string
  pressed: boolean
  onPressedChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPressedChange}
      className={cn(
        'text-[11px] font-medium rounded-md px-1.5 py-0.5 border transition-colors',
        pressed
          ? 'border-primary/40 bg-primary/10 text-foreground'
          : 'border-border/50 text-muted-foreground/80 hover:border-border',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {display}
    </button>
  )
}

export function DomainAccessPicker({
  levels,
  onChange,
  disabled,
  className,
}: {
  levels: DomainAccessLevels
  onChange: (levels: DomainAccessLevels) => void
  disabled?: boolean
  className?: string
}) {
  function select(domain: AccessDomainId, chip: DomainAccessChip) {
    onChange({
      ...levels,
      [domain]: toggleDomainLevel(levels[domain], chip),
    })
  }

  return (
    <div className={className}>
      {ACCESS_DOMAINS.map((group, i) => (
        <div
          key={group.domain}
          className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-border/30' : ''}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{group.label}</p>
            <p className="text-xs text-muted-foreground">{group.description}</p>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-4">
            {group.kind === 'read_write' && (
              <>
                <AccessChip
                  name={`${group.label}: Read`}
                  display="Read"
                  pressed={levels[group.domain] === 'read'}
                  onPressedChange={() => select(group.domain, 'read')}
                  disabled={disabled}
                />
                <AccessChip
                  name={`${group.label}: Read and write`}
                  display="Read and write"
                  pressed={levels[group.domain] === 'read_write'}
                  onPressedChange={() => select(group.domain, 'read_write')}
                  disabled={disabled}
                />
              </>
            )}
            {group.kind === 'write_only' && (
              <AccessChip
                name={`${group.label}: Write`}
                display="Write"
                pressed={levels[group.domain] === 'write'}
                onPressedChange={() => select(group.domain, 'write')}
                disabled={disabled}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
