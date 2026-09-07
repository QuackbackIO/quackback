/**
 * Required / additional mapping table. Presentation only: the card owns the
 * draft and persists through the operations API.
 */
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { DEFAULT_IDENTITY_SOURCES, type IdentitySource } from '@/lib/shared/oidc-claim-mapping'
import type { Role } from '@/lib/shared/roles'
import {
  SOURCE_LABELS,
  type ClaimsPeopleRow,
  type ClaimsProfileRow,
  type ClaimsRoleRow,
  type ClaimsTableRow,
  type ClaimsUnsupportedRow,
} from './provider-shared'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'admin',
  member: 'member',
  user: 'user',
}

export function ClaimsTable({
  requiredRows,
  additionalRows,
  allowMissingEmail,
  onAllowMissingEmailChange,
  peopleFlags,
  onPeopleFlagsChange,
  onEdit,
  onRemove,
  onResetName,
  disabled,
  autoCreateUsers,
  autoProvisionRole,
}: {
  requiredRows: ClaimsProfileRow[]
  additionalRows: ClaimsTableRow[]
  allowMissingEmail: boolean
  onAllowMissingEmailChange: (next: boolean) => void
  peopleFlags: { overrideExisting: boolean; syncOnSignIn: boolean }
  onPeopleFlagsChange: (next: { overrideExisting: boolean; syncOnSignIn: boolean }) => void
  onEdit: (row: ClaimsTableRow) => void
  onRemove: (row: ClaimsTableRow) => void
  onResetName: () => void
  disabled?: boolean
  autoCreateUsers: boolean
  autoProvisionRole: Role | null
}) {
  const hasPeople = additionalRows.some((row) => row.kind === 'people')
  const hasRole = additionalRows.some((row) => row.kind === 'role')
  const extraHint = !hasRole && !hasPeople

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium">Required identity</h3>
        <MappingTable>
          {requiredRows.map((row) => (
            <ProfileRow
              key={row.field}
              row={row}
              disabled={disabled}
              onEdit={() => onEdit(row)}
              emailConditional={row.field === 'email' && allowMissingEmail}
            />
          ))}
        </MappingTable>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <Checkbox
            checked={allowMissingEmail}
            onCheckedChange={(v) => onAllowMissingEmailChange(v === true)}
            disabled={disabled}
            aria-label="Allow accounts without an email address"
            className="mt-0.5"
          />
          <span>
            Allow accounts without an email address
            <span className="mt-0.5 block text-xs text-muted-foreground">
              For providers that release no email. Quackback creates a placeholder so people can
              still sign in, then asks them for a real address afterwards. Placeholders are
              permanent: turning this off later does not convert accounts that already have one.
              Off, these people cannot sign in at all.
            </span>
          </span>
        </label>
      </section>

      <section>
        <h3 className="text-sm font-medium">Additional attributes</h3>
        <MappingTable>
          {additionalRows.map((row) => {
            if (row.kind === 'profile') {
              return (
                <ProfileRow
                  key={row.field}
                  row={row}
                  disabled={disabled}
                  onEdit={() => onEdit(row)}
                  onResetName={!row.isDefault ? onResetName : undefined}
                />
              )
            }
            if (row.kind === 'role') {
              return (
                <RoleRowView
                  key="role"
                  row={row}
                  disabled={disabled}
                  autoCreateUsers={autoCreateUsers}
                  autoProvisionRole={autoProvisionRole}
                  onEdit={() => onEdit(row)}
                  onRemove={() => onRemove(row)}
                />
              )
            }
            if (row.kind === 'people') {
              return (
                <PeopleRowView
                  key={`people-${row.baselineIndex}`}
                  row={row}
                  disabled={disabled}
                  onEdit={() => onEdit(row)}
                  onRemove={() => onRemove(row)}
                />
              )
            }
            return <UnsupportedRowView key={row.id} row={row} />
          })}
        </MappingTable>
        {extraHint && (
          <p className="mt-3 text-xs text-muted-foreground">
            Add a Role mapping or map a claim to an attribute defined under People.
          </p>
        )}
      </section>

      {hasPeople && (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">People attribute updates</h3>
            <p className="text-xs text-muted-foreground">Applies to all mapped People attributes</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={peopleFlags.overrideExisting}
              onCheckedChange={(v) =>
                onPeopleFlagsChange({ ...peopleFlags, overrideExisting: v === true })
              }
              disabled={disabled}
              aria-label="Overwrite values that are already set"
              className="mt-0.5"
            />
            <span>
              Overwrite values that are already set
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Off: a claim only fills an attribute that is empty. On: the IdP value wins on every
                sign-in.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={peopleFlags.syncOnSignIn}
              onCheckedChange={(v) =>
                onPeopleFlagsChange({ ...peopleFlags, syncOnSignIn: v === true })
              }
              disabled={disabled}
              aria-label="Clear an attribute when its claim is missing"
              className="mt-0.5"
            />
            <span>
              Clear an attribute when its claim is missing
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Clearing on a fresh missing claim is independent of overwrite: a missing value can
                be removed even with overwrite off.
              </span>
            </span>
          </label>
        </section>
      )}
    </div>
  )
}

function MappingTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
              Quackback attribute
            </th>
            <th scope="col" className="min-w-0 py-2 pr-3 font-medium">
              IdP claim
            </th>
            <th scope="col" className="w-px py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function StatusBadge({ isDefault }: { isDefault: boolean }) {
  return (
    <Badge variant="outline" className="font-normal">
      {isDefault ? 'Default' : 'Custom'}
    </Badge>
  )
}

function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-1 shrink-0">{children}</div>
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={
        destructive
          ? 'h-7 px-2 text-muted-foreground hover:text-destructive'
          : 'h-7 px-2 text-muted-foreground hover:text-foreground'
      }
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  )
}

function ProfileRow({
  row,
  disabled,
  onEdit,
  onResetName,
  emailConditional,
}: {
  row: ClaimsProfileRow
  disabled?: boolean
  onEdit: () => void
  onResetName?: () => void
  emailConditional?: boolean
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-3 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.label}</span>
          <StatusBadge isDefault={row.isDefault} />
          {emailConditional && (
            <Badge variant="outline" className="font-normal">
              Required unless placeholder is allowed
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.helper}</p>
      </td>
      <td className="py-3 pr-3">
        <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
          {row.path}
        </code>
      </td>
      <td className="py-3">
        <RowActions>
          <IconButton label={`Edit ${row.label} mapping`} onClick={onEdit} disabled={disabled}>
            <PencilIcon className="h-3.5 w-3.5" />
          </IconButton>
          {onResetName && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onResetName}
              disabled={disabled}
            >
              Reset mapping
            </Button>
          )}
        </RowActions>
      </td>
    </tr>
  )
}

function RoleRowView({
  row,
  disabled,
  autoCreateUsers,
  autoProvisionRole,
  onEdit,
  onRemove,
}: {
  row: ClaimsRoleRow
  disabled?: boolean
  autoCreateUsers: boolean
  autoProvisionRole: Role | null
  onEdit: () => void
  onRemove: () => void
}) {
  const fallback = autoProvisionRole ?? 'member'
  const fallbackLabel =
    autoProvisionRole == null ? 'Member (runtime default)' : ROLE_LABEL[fallback]
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-3 pr-3">
        <div className="font-medium">Role</div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
          {row.rules.map((rule, index) => (
            <li key={index}>
              {rule.whenContains} {'->'} {ROLE_LABEL[rule.role]}
            </li>
          ))}
        </ol>
        <p className="mt-1 text-xs text-muted-foreground">
          Otherwise: {fallbackLabel}, at verified domains
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          A matching rule assigns this role even outside this provider&apos;s verified domains.
        </p>
        {!autoCreateUsers && (
          <p className="mt-1 text-xs text-muted-foreground">
            All role application is disabled when auto-create is off.
          </p>
        )}
        {row.syncOnEverySignIn && (
          <p className="mt-1 text-xs text-muted-foreground">Reapplies on every sign-in.</p>
        )}
      </td>
      <td className="py-3 pr-3">
        <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
          {row.claimPath}
        </code>
      </td>
      <td className="py-3">
        <RowActions>
          <IconButton label="Edit Role mapping" onClick={onEdit} disabled={disabled}>
            <PencilIcon className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label="Remove Role mapping"
            onClick={onRemove}
            disabled={disabled}
            destructive
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </RowActions>
      </td>
    </tr>
  )
}

function PeopleRowView({
  row,
  disabled,
  onEdit,
  onRemove,
}: {
  row: ClaimsPeopleRow
  disabled?: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-3 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.label}</span>
          {row.typeLabel && (
            <span className="text-xs text-muted-foreground">
              {row.attributeKey}, {row.typeLabel}
            </span>
          )}
          {row.orphaned && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              attribute no longer exists
            </Badge>
          )}
          {row.duplicate && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-700 dark:text-amber-400"
            >
              Duplicate mapping
            </Badge>
          )}
        </div>
      </td>
      <td className="py-3 pr-3">
        <code className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
          {row.claimPath}
        </code>
      </td>
      <td className="py-3">
        <RowActions>
          <IconButton label={`Edit ${row.label} mapping`} onClick={onEdit} disabled={disabled}>
            <PencilIcon className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton
            label={`Remove ${row.label} mapping`}
            onClick={onRemove}
            disabled={disabled}
            destructive
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </RowActions>
      </td>
    </tr>
  )
}

function UnsupportedRowView({ row }: { row: ClaimsUnsupportedRow }) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-3 pr-3">
        <div className="font-medium">{row.label}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
      </td>
      <td className="py-3 pr-3 text-xs text-muted-foreground">Unsupported</td>
      <td className="py-3" />
    </tr>
  )
}

export function AdvancedSourcesEditor({
  sources,
  onChange,
  disabled,
}: {
  sources: IdentitySource[]
  onChange: (next: IdentitySource[]) => void
  disabled?: boolean
}) {
  const enabled = new Set(sources)
  const ordered: IdentitySource[] = []
  for (const source of sources) {
    if (!ordered.includes(source)) ordered.push(source)
  }
  for (const source of DEFAULT_IDENTITY_SOURCES) {
    if (!ordered.includes(source)) ordered.push(source)
  }
  if (!ordered.includes('accessTokenJwt')) ordered.push('accessTokenJwt')

  const toggle = (source: IdentitySource, on: boolean) => {
    if (on) {
      if (enabled.has(source)) return
      onChange([...sources, source])
      return
    }
    const next = sources.filter((s) => s !== source)
    if (next.length === 0) return
    onChange(next)
  }

  const move = (index: number, dir: -1 | 1) => {
    const next = [...sources]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    onChange(next)
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <details className="group">
        <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">
          Advanced sources
        </summary>
        <div className="space-y-3 border-t border-border/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Read identity from enabled sources in this order:
          </p>
          <ol className="space-y-2">
            {ordered.map((source) => {
              const checked = enabled.has(source)
              const index = sources.indexOf(source)
              return (
                <li key={source} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggle(source, v === true)}
                    disabled={disabled || (checked && sources.length === 1)}
                    aria-label={SOURCE_LABELS[source]}
                  />
                  <span className="flex-1">
                    {index >= 0 ? `${index + 1}. ` : ''}
                    {SOURCE_LABELS[source]}
                  </span>
                  {checked && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        aria-label={`Move ${SOURCE_LABELS[source]} up`}
                        disabled={disabled || index <= 0}
                        onClick={() => move(index, -1)}
                      >
                        <ChevronUpIcon className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        aria-label={`Move ${SOURCE_LABELS[source]} down`}
                        disabled={disabled || index < 0 || index >= sources.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDownIcon className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ol>
          <p className="text-xs text-muted-foreground">
            The access token is audience-scoped and its subject may differ from the ID token. Leave
            this off unless this IdP puts identity only there.
          </p>
          <p className="text-xs text-muted-foreground">
            Changing sources can change account matching and requires a new connection test.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange([...DEFAULT_IDENTITY_SOURCES])}
          >
            Restore default sources
          </Button>
        </div>
      </details>
    </div>
  )
}
