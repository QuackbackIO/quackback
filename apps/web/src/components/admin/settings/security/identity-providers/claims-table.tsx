/**
 * The Profile table: which provider claim sets each Quackback field.
 * Presentation only; the card owns the draft and persists through the
 * operations API.
 *
 * One table, not two. Account ID, email, name, username and avatar are the
 * profile; role rules and People attributes are extra mappings the admin
 * added. Standard rows carry no badge; only an exception is marked, as
 * "Custom". Each profile row says in one muted line what it expects, and once the provider has a test sign-in a third column shows what
 * each field takes from it under the current draft, so a claim is chosen by
 * what the provider actually sent.
 */
import { PencilIcon, TrashIcon } from '@heroicons/react/24/solid'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { DEFAULT_IDENTITY_SOURCES, type IdentitySource } from '@/lib/shared/oidc-claim-mapping'
import type { Role } from '@/lib/shared/roles'
import type { ProfileFieldValues } from '@/lib/shared/sso-mapping-preview'
import { PictureWithUrl } from './claim-picture'
import {
  PROFILE_FIELD_SPECS,
  SOURCE_LABELS,
  type ClaimsPeopleRow,
  type ClaimsProfileRow,
  type ClaimsRoleRow,
  type ClaimsTableRow,
  type ClaimsUnsupportedRow,
} from './provider-shared'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'User',
}

export function ClaimsTable({
  profileRows,
  additionalRows,
  peopleFlags,
  onPeopleFlagsChange,
  onEdit,
  onRemove,
  providerLabel,
  disabled,
  testValues,
}: {
  profileRows: ClaimsProfileRow[]
  additionalRows: ClaimsTableRow[]
  peopleFlags: { overrideExisting: boolean; syncOnSignIn: boolean }
  onPeopleFlagsChange: (next: { overrideExisting: boolean; syncOnSignIn: boolean }) => void
  onEdit: (row: ClaimsTableRow) => void
  onRemove: (row: ClaimsTableRow) => void
  /** Names the claim column ("Acme ID claim"); "Provider claim" without one. */
  providerLabel?: string
  disabled?: boolean
  /** What each profile field takes from the last test sign-in. Adds the
   *  "Last test sign-in" column; omitted when there is no test. */
  testValues?: ProfileFieldValues | null
}) {
  const hasPeople = additionalRows.some((row) => row.kind === 'people')
  const showTest = testValues != null

  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/50 text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
              Field
            </th>
            <th scope="col" className="min-w-0 py-2 pr-3 font-medium">
              {providerLabel?.trim() ? `${providerLabel.trim()} claim` : 'Provider claim'}
            </th>
            {showTest && (
              <th scope="col" className="py-2 pr-3 font-medium whitespace-nowrap">
                Last test sign-in
              </th>
            )}
            <th scope="col" className="w-px py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {profileRows.map((row) => (
            <ProfileRow
              key={row.field}
              row={row}
              testValues={testValues}
              disabled={disabled}
              onEdit={() => onEdit(row)}
            />
          ))}
          {additionalRows.map((row) => {
            if (row.kind === 'role') {
              return (
                <RoleRowView
                  key="role"
                  row={row}
                  showTest={showTest}
                  disabled={disabled}
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
                  showTest={showTest}
                  disabled={disabled}
                  onEdit={() => onEdit(row)}
                  onRemove={() => onRemove(row)}
                />
              )
            }
            if (row.kind === 'unsupported') {
              return <UnsupportedRowView key={row.id} row={row} showTest={showTest} />
            }
            return null
          })}
        </tbody>
      </table>

      {hasPeople && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={peopleFlags.overrideExisting}
              onCheckedChange={(v) =>
                onPeopleFlagsChange({ ...peopleFlags, overrideExisting: v === true })
              }
              disabled={disabled}
              aria-label="Overwrite attribute values that are already set"
              className="mt-0.5"
            />
            <span>Overwrite attribute values that are already set</span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={peopleFlags.syncOnSignIn}
              onCheckedChange={(v) =>
                onPeopleFlagsChange({ ...peopleFlags, syncOnSignIn: v === true })
              }
              disabled={disabled}
              aria-label="Clear an attribute when its claim is missing"
              className="mt-0.5"
            />
            <span>Clear an attribute when its claim is missing</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ClaimPath({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </code>
  )
}

function CustomBadge() {
  return <Badge variant="outline">Custom</Badge>
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

/** An empty cell in the test column, for rows that are not profile fields. */
function NoTestValue({ show }: { show: boolean }) {
  return show ? <td className="py-2.5 pr-3" /> : null
}

/**
 * The value one profile field takes from the test sign-in. The avatar shows
 * the picture itself. A field that gets nothing says what happens instead.
 */
function TestValue({
  field,
  values,
}: {
  field: ClaimsProfileRow['field']
  values: ProfileFieldValues
}) {
  const emptyText = PROFILE_FIELD_SPECS[field].emptyTestText
  if (field === 'image') {
    return <PictureWithUrl url={values.image} missingText={emptyText} className="size-8" />
  }
  const value = values[field]
  if (!value) return <span className="text-muted-foreground">{emptyText}</span>
  return (
    <span className="block truncate" title={value}>
      {value}
    </span>
  )
}

function ProfileRow({
  row,
  testValues,
  disabled,
  onEdit,
}: {
  row: ClaimsProfileRow
  testValues?: ProfileFieldValues | null
  disabled?: boolean
  onEdit: () => void
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.label}</span>
          {!row.isDefault && <CustomBadge />}
        </div>
        <p className="mt-0.5 text-xs whitespace-nowrap text-muted-foreground">{row.hint}</p>
      </td>
      <td className="py-2.5 pr-3">
        <ClaimPath>{row.path}</ClaimPath>
      </td>
      {testValues && (
        // max-w-0 with w-full gives this column the remaining width, so long
        // values truncate instead of widening the table.
        <td className="w-full max-w-0 py-2.5 pr-3">
          <TestValue field={row.field} values={testValues} />
        </td>
      )}
      <td className="py-2.5">
        <IconButton label={`Edit ${row.label} mapping`} onClick={onEdit} disabled={disabled}>
          <PencilIcon className="h-3.5 w-3.5" />
        </IconButton>
      </td>
    </tr>
  )
}

function RoleRowView({
  row,
  showTest,
  disabled,
  onEdit,
  onRemove,
}: {
  row: ClaimsRoleRow
  showTest: boolean
  disabled?: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <div className="font-medium">Role</div>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {row.rules.map((rule, index) => (
            <li key={index}>
              <span className="font-mono text-xs">{rule.whenContains}</span> {'->'}{' '}
              {ROLE_LABEL[rule.role]}
            </li>
          ))}
          {row.rules.length === 0 && <li>No rules yet.</li>}
        </ul>
        {row.syncOnEverySignIn && (
          <p className="mt-1 text-muted-foreground">Reapplied on every sign-in.</p>
        )}
      </td>
      <td className="py-2.5 pr-3">
        <ClaimPath>{row.claimPath}</ClaimPath>
      </td>
      <NoTestValue show={showTest} />
      <td className="py-2.5">
        <div className="flex items-center justify-end gap-1">
          <IconButton label="Edit role rules" onClick={onEdit} disabled={disabled}>
            <PencilIcon className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Remove role rules" onClick={onRemove} disabled={disabled} destructive>
            <TrashIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </td>
    </tr>
  )
}

function PeopleRowView({
  row,
  showTest,
  disabled,
  onEdit,
  onRemove,
}: {
  row: ClaimsPeopleRow
  showTest: boolean
  disabled?: boolean
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.label}</span>
          {row.typeLabel && <span className="text-muted-foreground">{row.typeLabel}</span>}
          {row.orphaned && (
            <Badge variant="outline" className="border-warning/40 text-warning">
              Attribute no longer exists
            </Badge>
          )}
          {row.duplicate && (
            <Badge variant="outline" className="border-warning/40 text-warning">
              Duplicate
            </Badge>
          )}
        </div>
      </td>
      <td className="py-2.5 pr-3">
        <ClaimPath>{row.claimPath}</ClaimPath>
      </td>
      <NoTestValue show={showTest} />
      <td className="py-2.5">
        <div className="flex items-center justify-end gap-1">
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
        </div>
      </td>
    </tr>
  )
}

function UnsupportedRowView({ row, showTest }: { row: ClaimsUnsupportedRow; showTest: boolean }) {
  return (
    <tr className="border-b border-border/50 last:border-0 align-top">
      <td className="py-2.5 pr-3">
        <div className="font-medium">{row.label}</div>
        <p className="mt-0.5 text-muted-foreground">{row.detail}</p>
      </td>
      <td className="py-2.5 pr-3 text-muted-foreground">Not editable here</td>
      <NoTestValue show={showTest} />
      <td className="py-2.5" />
    </tr>
  )
}

/**
 * Compatibility: where identity claims are read from, and in what order.
 * Standard OIDC is ID token then UserInfo, and that is what every provider
 * gets unless someone changes it here. The access token is deliberately off
 * by default — it can be issued for another API, and Microsoft tells clients
 * to treat it as opaque — so enabling it is a per-provider choice.
 */
export function IdentitySourcesEditor({
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

  const isDefault = JSON.stringify(sources) === JSON.stringify(DEFAULT_IDENTITY_SOURCES)

  return (
    <div className="space-y-3" data-testid="identity-sources-editor">
      <div>
        <div className="text-sm font-medium">Identity sources</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Standard OpenID Connect reads the ID token, then UserInfo. Change this only for a provider
          that puts identity somewhere else. Changing it can change which account a person matches
          and needs a new connection test.
        </p>
      </div>
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
                {source === 'accessTokenJwt' && (
                  <span className="text-muted-foreground"> (may be issued for another API)</span>
                )}
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
      {!isDefault && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([...DEFAULT_IDENTITY_SOURCES])}
        >
          Use standard sources
        </Button>
      )}
    </div>
  )
}
