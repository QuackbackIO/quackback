/**
 * Claim-to-role mapping: an optional override on top of the provider's Default
 * role. With no rules everyone gets the default. The Claim path and each rule
 * value are creatable autocompletes sourced from the last matching test sign-in
 * (free text still allowed). Opens when `mapping !== null` or when a matching
 * test produced suggestions. The card that owns this persists `undefined`
 * unless the mapping carries rules or sync (see `normalizeRoleMapping`).
 */
import { useEffect, useState } from 'react'
import { AdjustmentsHorizontalIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
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
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import { ROLES, type RoleMapping } from './provider-shared'

export function ClaimMappingEditor({
  mapping,
  disabled,
  registrationId,
  canTest,
  onChange,
}: {
  mapping: RoleMapping | null
  disabled: boolean
  registrationId: string
  /** True once the provider is saved, so a test sign-in can actually run. */
  canTest: boolean
  onChange: (mapping: RoleMapping | null) => void
}) {
  const ruleCount = mapping?.rules.length ?? 0
  const hasConfig = mapping !== null
  const current: RoleMapping = mapping ?? { claimPath: 'groups', rules: [] }
  const update = (patch: Partial<RoleMapping>) => onChange({ ...current, ...patch })

  const { lastSuccess } = useSsoTestSignIn()
  const suggestions =
    lastSuccess && lastSuccess.registrationId === registrationId
      ? deriveClaimSuggestions(lastSuccess.claims)
      : null
  const hasSuggestions = (suggestions?.paths.length ?? 0) > 0
  const pathSuggestions = (suggestions?.paths ?? []).map((p) => ({ value: p }))
  const valueSuggestions = (suggestions?.valuesByPath[current.claimPath] ?? []).map((v) => ({
    value: v,
  }))

  // Initialize open with hasSuggestions too, so a matching test sign-in's
  // suggestions don't cause a closed-then-open flash on mount.
  const [open, setOpen] = useState(hasConfig || hasSuggestions)
  useEffect(() => {
    if (hasSuggestions) setOpen(true)
  }, [hasSuggestions])

  // Auto-fill the claim path when the IdP returned exactly one array claim and
  // the provider has no mapping yet. Only overrides the untouched `groups`
  // default; never fights a value the admin chose. Self-settles: once filled,
  // `mapping` is non-null so this no-ops (relies on `onChange` being the stable
  // `setMapping` setter that flips `mapping` non-null).
  const onlyPath = suggestions && suggestions.paths.length === 1 ? suggestions.paths[0] : null
  useEffect(() => {
    if (mapping === null && onlyPath && onlyPath !== 'groups') {
      onChange({ claimPath: onlyPath, rules: [] })
    }
  }, [mapping, onlyPath, onChange])

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <AdjustmentsHorizontalIcon className="size-4 text-muted-foreground" />
          Map roles from claims
          {ruleCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              · {ruleCount} rule{ruleCount === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-muted-foreground">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Source the role from an IdP claim. Rules are first-match-wins; with no rules everyone
            gets the default role from Accounts.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="idp-claim-path">Claim path</Label>
            <Autocomplete
              value={current.claimPath}
              onValueChange={(v) => update({ claimPath: v })}
              suggestions={pathSuggestions}
              ariaLabel="Claim path"
              placeholder="groups, realm_access.roles, https://acme.com/roles"
              emptyHint={
                <div className="space-y-2 px-1 py-3 text-center">
                  <p className="text-xs text-muted-foreground">
                    Run a test sign-in to discover your IdP&apos;s claims.
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Or type a path like groups, realm_access.roles, or https://acme.com/roles.
                  </p>
                  <TestSignInButton
                    registrationId={registrationId}
                    disabled={disabled || !canTest}
                  />
                </div>
              }
              disabled={disabled}
              className="w-full"
            />
            {hasSuggestions && suggestions && (
              <p className="text-xs text-muted-foreground">
                From your test sign-in: {suggestions.paths.join(', ')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Rules</Label>
            {current.rules.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No rules. Everyone gets the default role.
              </p>
            )}
            {current.rules.map((rule, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-muted-foreground">contains</span>
                <Autocomplete
                  value={rule.whenContains}
                  onValueChange={(v) =>
                    update({
                      rules: current.rules.map((r, i) =>
                        i === index ? { ...r, whenContains: v } : r
                      ),
                    })
                  }
                  suggestions={valueSuggestions}
                  ariaLabel={`Claim value to match (rule ${index + 1})`}
                  placeholder="value to match"
                  emptyHint="No values seen yet. Type the value to match."
                  disabled={disabled}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground">→</span>
                <Select
                  value={rule.role}
                  onValueChange={(r) =>
                    update({
                      rules: current.rules.map((rr, i) =>
                        i === index ? { ...rr, role: r as Role } : rr
                      ),
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  aria-label="Remove rule"
                  onClick={() => update({ rules: current.rules.filter((_, i) => i !== index) })}
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
                update({ rules: [...current.rules, { whenContains: '', role: 'member' }] })
              }
              disabled={disabled}
            >
              <PlusIcon className="size-3.5" />
              Add rule
            </Button>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <Switch
              checked={current.syncOnEverySignIn ?? false}
              onCheckedChange={(v) => update({ syncOnEverySignIn: v })}
              className="mt-0.5"
              disabled={disabled}
            />
            <span>
              <span className="font-medium">Sync role on every sign-in.</span> Re-applies the rules
              so a role can be promoted or demoted when their claims change. Off: set once, on first
              sign-in.
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
