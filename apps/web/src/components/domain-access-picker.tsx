import { useIntl } from 'react-intl'
import {
  ACCESS_DOMAINS,
  toggleDomainLevel,
  type AccessDomainId,
  type DomainAccessChip,
  type DomainAccessKind,
  type DomainAccessLevels,
} from '@/lib/shared/api-key-scopes'
import { isChipWithinRequest } from '@/lib/shared/domain-access'
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

/** The picker's words, for a page in another message area. */
export interface DomainAccessWords {
  label: (domain: AccessDomainId) => string
  description: (domain: AccessDomainId) => string
  read: string
  readWrite: string
  write: string
  /** A chip's accessible name: "Feedback: Read". */
  chipName: (domainLabel: string, levelLabel: string) => string
  highImpact: string
}

export function DomainAccessPicker({
  levels,
  onChange,
  disabled,
  className,
  allowed,
  flagHighImpact,
  words,
}: {
  levels: DomainAccessLevels
  onChange: (levels: DomainAccessLevels) => void
  disabled?: boolean
  className?: string
  /** The most each domain may be given. Chips above it are disabled. */
  allowed?: DomainAccessLevels
  /** Mark read and write on Settings as high impact (it can change the workspace). */
  flagHighImpact?: boolean
  /** Words for every label; without them the picker reads in English. */
  words?: DomainAccessWords
}) {
  const intl = useIntl()
  if (words) {
    return (
      <PickerRows
        levels={levels}
        onChange={onChange}
        disabled={disabled}
        className={className}
        allowed={allowed}
        flagHighImpact={flagHighImpact}
        words={words}
      />
    )
  }
  const within = (domain: AccessDomainId, chip: DomainAccessChip) =>
    !allowed || isChipWithinRequest(allowed, domain, chip)
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
            <p className="flex items-center gap-2 text-sm font-medium">
              {group.domain === 'settings'
                ? intl.formatMessage({ id: 'apiKeys.scopes.settings', defaultMessage: 'Settings' })
                : group.label}
              {flagHighImpact &&
                group.domain === 'settings' &&
                levels.settings === 'read_write' && (
                  <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                    {intl.formatMessage({
                      id: 'apiKeys.highImpact',
                      defaultMessage: 'High impact',
                    })}
                  </span>
                )}
            </p>
            <p className="text-xs text-muted-foreground">
              {group.domain === 'settings'
                ? intl.formatMessage({
                    id: 'apiKeys.scopes.settingsDescription',
                    defaultMessage: 'Branding, Messenger, modules, and office hours',
                  })
                : group.description}
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0 ml-4">
            {group.kind === 'read_write' && (
              <>
                <AccessChip
                  name={
                    group.domain === 'settings'
                      ? intl.formatMessage({
                          id: 'apiKeys.scopes.settingsRead',
                          defaultMessage: 'Settings: Read',
                        })
                      : `${group.label}: Read`
                  }
                  display={
                    group.domain === 'settings'
                      ? intl.formatMessage({ id: 'apiKeys.scopes.read', defaultMessage: 'Read' })
                      : 'Read'
                  }
                  pressed={levels[group.domain] === 'read'}
                  onPressedChange={() => select(group.domain, 'read')}
                  disabled={disabled || !within(group.domain, 'read')}
                />
                <AccessChip
                  name={
                    group.domain === 'settings'
                      ? intl.formatMessage({
                          id: 'apiKeys.scopes.settingsReadWrite',
                          defaultMessage: 'Settings: Read and write',
                        })
                      : `${group.label}: Read and write`
                  }
                  display={
                    group.domain === 'settings'
                      ? intl.formatMessage({
                          id: 'apiKeys.scopes.readWrite',
                          defaultMessage: 'Read and write',
                        })
                      : 'Read and write'
                  }
                  pressed={levels[group.domain] === 'read_write'}
                  onPressedChange={() => select(group.domain, 'read_write')}
                  disabled={disabled || !within(group.domain, 'read_write')}
                />
              </>
            )}
            {group.kind === 'write_only' && (
              <AccessChip
                name={`${group.label}: Write`}
                display="Write"
                pressed={levels[group.domain] === 'write'}
                onPressedChange={() => select(group.domain, 'write')}
                disabled={disabled || !within(group.domain, 'write')}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** The picker's rows, every label taken from `words`. */
function PickerRows({
  levels,
  onChange,
  disabled,
  className,
  allowed,
  flagHighImpact,
  words,
}: {
  levels: DomainAccessLevels
  onChange: (levels: DomainAccessLevels) => void
  disabled?: boolean
  className?: string
  allowed?: DomainAccessLevels
  flagHighImpact?: boolean
  words: DomainAccessWords
}) {
  const within = (domain: AccessDomainId, chip: DomainAccessChip) =>
    !allowed || isChipWithinRequest(allowed, domain, chip)
  const select = (domain: AccessDomainId, chip: DomainAccessChip) =>
    onChange({ ...levels, [domain]: toggleDomainLevel(levels[domain], chip) })
  const chips: Record<DomainAccessKind, { chip: DomainAccessChip; label: string }[]> = {
    read_write: [
      { chip: 'read', label: words.read },
      { chip: 'read_write', label: words.readWrite },
    ],
    write_only: [{ chip: 'write', label: words.write }],
  }

  return (
    <div className={className}>
      {ACCESS_DOMAINS.map((group, i) => {
        const label = words.label(group.domain)
        return (
          <div
            key={group.domain}
            className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-border/30' : ''}`}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium">
                {label}
                {flagHighImpact &&
                  group.domain === 'settings' &&
                  levels.settings === 'read_write' && (
                    <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-warning">
                      {words.highImpact}
                    </span>
                  )}
              </p>
              <p className="text-xs text-muted-foreground">{words.description(group.domain)}</p>
            </div>
            <div className="flex gap-1.5 shrink-0 ml-4">
              {chips[group.kind].map(({ chip, label: chipLabel }) => (
                <AccessChip
                  key={chip}
                  name={words.chipName(label, chipLabel)}
                  display={chipLabel}
                  pressed={levels[group.domain] === chip}
                  onPressedChange={() => select(group.domain, chip)}
                  disabled={disabled || !within(group.domain, chip)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
