/**
 * Role rules: which claim to read and which value grants which role. The
 * claim path and each rule value are creatable autocompletes sourced from the
 * last matching test sign-in (free text still allowed). Rendered inside the
 * Add/Edit mapping dialog; the User details editor owns persistence.
 */
import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import type { Role } from '@/lib/shared/roles'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Autocomplete } from '@/components/ui/autocomplete'
import { deriveClaimSuggestions } from '@/lib/shared/claim-suggestions'
import { captureSuggestionClaims, type SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import { ClaimPathInput } from './claim-path-input'
import { ROLES, type RoleMapping } from './provider-shared'

const ROLE_OPTION_LABEL: Record<Role, string> = {
  admin: 'Admin',
  member: 'Member',
  user: 'User',
}

export function RoleMappingRulesBody({
  mapping,
  disabled,
  registrationId,
  canTest,
  capture,
  autoCreateUsers,
  onChange,
}: {
  mapping: RoleMapping
  disabled: boolean
  registrationId: string
  canTest: boolean
  capture?: SsoTestCapture | null
  autoCreateUsers?: boolean
  onChange: (mapping: RoleMapping) => void
}) {
  const { lastSuccess, lastCapture } = useSsoTestSignIn()
  const fixture =
    (capture && capture.registrationId === registrationId ? capture : null) ??
    (lastCapture && lastCapture.registrationId === registrationId ? lastCapture : null) ??
    (lastSuccess && lastSuccess.registrationId === registrationId ? lastSuccess : null)
  const suggestions = fixture ? deriveClaimSuggestions(captureSuggestionClaims(fixture)) : null
  const valueSuggestions = (suggestions?.valuesByPath[mapping.claimPath] ?? []).map((v) => ({
    value: v,
  }))
  const update = (patch: Partial<RoleMapping>) => onChange({ ...mapping, ...patch })
  const moveRule = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= mapping.rules.length) return
    const next = [...mapping.rules]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    update({ rules: next })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="idp-claim-path">Provider claim</Label>
        <ClaimPathInput
          value={mapping.claimPath}
          onChange={(claimPath) => update({ claimPath })}
          registrationId={registrationId}
          canTest={canTest}
          placeholder="groups, realm_access.roles, https://acme.com/roles"
          ariaLabel="Role claim path"
          disabled={disabled}
          capture={capture}
          suggestionsFor="role"
        />
      </div>

      <div className="space-y-2">
        <Label>Rules</Label>
        <p className="text-sm text-muted-foreground">
          The first rule whose value appears in the claim wins. A matching rule grants its role even
          outside this provider&apos;s verified domains.
        </p>
        {mapping.rules.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No rules yet. Everyone gets the new account role.
          </p>
        )}
        {mapping.rules.map((rule, index) => (
          <div key={index} className="flex items-center gap-2">
            <Autocomplete
              value={rule.whenContains}
              onValueChange={(v) =>
                update({
                  rules: mapping.rules.map((r, i) => (i === index ? { ...r, whenContains: v } : r)),
                })
              }
              suggestions={valueSuggestions}
              ariaLabel={`Claim value to match (rule ${index + 1})`}
              placeholder="value to match"
              emptyHint="No values seen yet. Type the value to match."
              disabled={disabled}
              className="flex-1"
            />
            <Select
              value={rule.role}
              onValueChange={(r) =>
                update({
                  rules: mapping.rules.map((rr, i) =>
                    i === index ? { ...rr, role: r as Role } : rr
                  ),
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="w-32" aria-label={`Quackback role (rule ${index + 1})`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_OPTION_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              aria-label={`Move rule ${index + 1} up`}
              onClick={() => moveRule(index, -1)}
              disabled={disabled || index === 0}
            >
              <ChevronUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              aria-label={`Move rule ${index + 1} down`}
              onClick={() => moveRule(index, 1)}
              disabled={disabled || index === mapping.rules.length - 1}
            >
              <ChevronDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() => update({ rules: mapping.rules.filter((_, i) => i !== index) })}
              disabled={disabled}
            >
              <TrashIcon className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() =>
            update({ rules: [...mapping.rules, { whenContains: '', role: 'member' }] })
          }
          disabled={disabled}
        >
          <PlusIcon className="size-3.5" />
          Add rule
        </Button>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <Switch
          checked={mapping.syncOnEverySignIn ?? false}
          onCheckedChange={(v) => update({ syncOnEverySignIn: v })}
          className="mt-0.5"
          disabled={disabled}
          aria-label="Reapply roles on every sign-in"
        />
        <span>
          Reapply roles on every sign-in
          <span className="mt-0.5 block text-muted-foreground">
            Off, existing people keep their current role.
            {autoCreateUsers === false
              ? ' Roles are not applied while account creation is off.'
              : ''}
          </span>
        </span>
      </label>
    </div>
  )
}
