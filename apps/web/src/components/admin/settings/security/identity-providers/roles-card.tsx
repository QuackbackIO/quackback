/**
 * Roles: the role each person gets when they sign in with this provider,
 * written the way sign-in decides it. Rules are checked from the top and the
 * first match wins, whatever the person's email domain. Otherwise someone with
 * an email at one of the provider's verified domains gets the default role,
 * and everyone else stays a portal user.
 *
 * Like Profile, the card is always open and edits a local draft. Cancel and
 * Save changes appear only while the draft differs from what is stored. One
 * Save writes the rules (claim mapping operations) and the default role (a
 * provider patch). New or changed admin rules still ask first, and "Every
 * sign-in" is refused when it would take admin access away from the admins
 * who sign in with this provider.
 */
import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import type { Role } from '@/lib/shared/roles'
import { cn } from '@/lib/shared/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Autocomplete } from '@/components/ui/autocomplete'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import {
  adminTierRoleIds,
  canManageSso,
  diffClaimMappingOperations,
  mappingSaveRisks,
  roleRuleRoleIds,
} from '@/lib/shared/sso-claim-mapping-edit'
import { previewRoleRuleMatches } from '@/lib/shared/sso-mapping-preview'
import { captureIdentityCaption, type SsoTestCapture } from '@/lib/shared/sso-test-capture'
import { ClaimPathInput } from './claim-path-input'
import { mergeClaimMapping, normalizeRoleMapping, type RoleMapping } from './provider-shared'
import {
  ROLE_PRESET_LABELS,
  effectiveDefaultRole,
  MISSING_ROLE_NOTE,
  grantableRoles,
  signInRoleOutcome,
  verifiedDomainNames,
  type RoleRuleDraft,
} from './role-outcome'
import { useProviderCapture } from './use-connection-test'
import { useProviderSave } from './use-provider-save'
import { usePublishRolesDraft } from './roles-draft-context'
import { useProviderAdmins, type ProviderAdmin } from './use-provider-admins'

/** Focus borders added here stay neutral; the shared ring is not. */
const NEUTRAL_FOCUS = 'focus-visible:border-muted-foreground focus-visible:ring-muted-foreground/30'
/** The same for buttons and select triggers, whose shared focus styles differ. */
const NEUTRAL_BUTTON_FOCUS = 'focus-visible:ring-muted-foreground/40'
const NEUTRAL_SELECT_FOCUS = 'focus:border-muted-foreground'
const NEUTRAL_LINK_FOCUS =
  'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-muted-foreground'
const PRESETS: Role[] = ['admin', 'member', 'user']
const CUSTOM_PREFIX = 'custom:'

export function RolesCard({ provider }: { provider: IdentityProvider }) {
  const label = provider.label.trim() || 'your provider'
  return (
    <div id="roles" className="scroll-mt-6">
      <SettingsCard
        title="Roles"
        description={`The role each person gets when they sign in with ${label}. Checked from the top; the first match wins.`}
        contentClassName="space-y-5"
      >
        <RolesEditor provider={provider} label={label} />
      </SettingsCard>
    </div>
  )
}

type StoredMapping = IdentityProvider['claimMapping']
type Mode = 'first' | 'every'

interface RolesDraft {
  claimPath: string
  rules: RoleRuleDraft[]
  mode: Mode
  defaultRole: Role
}

interface Baseline {
  mapping: StoredMapping
  autoProvisionRole: Role | null
}

function draftFrom(baseline: Baseline): RolesDraft {
  const role = baseline.mapping?.role
  return {
    claimPath: role?.claimPath ?? 'groups',
    rules: (role?.rules ?? []).map((rule) => ({ ...rule })),
    mode: role?.syncOnEverySignIn === true ? 'every' : 'first',
    defaultRole: effectiveDefaultRole(baseline.autoProvisionRole),
  }
}

/** The role section Save would write. Nothing configured is absent. */
function roleSection(draft: RolesDraft): RoleMapping | undefined {
  const rules = draft.rules.map((rule) => ({
    whenContains: rule.whenContains.trim(),
    role: rule.role,
    ...(rule.roleId ? { roleId: rule.roleId } : {}),
  }))
  return normalizeRoleMapping({
    claimPath: draft.claimPath.trim(),
    rules,
    ...(draft.mode === 'every' ? { syncOnEverySignIn: true } : {}),
  })
}

/** Rules that hand out admin-level access: the Admin preset, or a custom
 *  role whose permissions reach it. */
function adminRulesOf(role: RoleMapping | undefined | null, tierIds: ReadonlySet<string>) {
  return (role?.rules ?? [])
    .filter((r) => (r.roleId ? tierIds.has(r.roleId) : r.role === 'admin'))
    .map((r) => [r.whenContains, r.roleId ?? r.role])
}

/** Roles that hold SSO management (auth.manage); a rule giving one keeps it. */
function ssoManagerRoleIds(
  roles: ReadonlyArray<{ id: string; permissionKeys: readonly string[] }>
): Set<string> {
  return new Set(roles.filter((r) => canManageSso(r.permissionKeys)).map((r) => r.id))
}

function RolesEditor({ provider, label }: { provider: IdentityProvider; label: string }) {
  const { saving, save, saveClaimMapping } = useProviderSave(provider)
  const capture = useProviderCapture(provider)
  const { data: rolesData } = useQuery(settingsQueries.roles())
  const customRoles = (rolesData?.roles ?? []).filter((r) => !r.isSystem)
  // Roles a rule may name; undefined until the list loads, so nothing reads
  // as missing before it does.
  const liveRoles = rolesData ? grantableRoles(rolesData.roles) : undefined
  const roleMissing = (rule: RoleRuleDraft) =>
    Boolean(rule.roleId && liveRoles && !liveRoles.some((r) => r.id === rule.roleId))
  const tierIds = adminTierRoleIds(rolesData?.roles ?? [])
  const [confirmOpen, setConfirmOpen] = useState(false)
  // A refused save, shown on the rules it names until the next edit.
  const [ruleError, setRuleError] = useState<{ roleIds: string[]; message: string } | null>(null)
  // The server's own lockout refusal, shown by the choice it refused.
  const [syncRefused, setSyncRefused] = useState<string | null>(null)

  const stored: Baseline = {
    mapping: provider.claimMapping,
    autoProvisionRole: provider.autoProvisionRole,
  }
  // `baseline` is what the draft is compared with and Cancel returns to: the
  // stored values, or what this card just saved until the refetch lands.
  const [baseline, setBaseline] = useState<Baseline>(stored)
  const [seen, setSeen] = useState<Baseline>(stored)
  const [draft, setDraft] = useState<RolesDraft>(() => draftFrom(stored))

  const roleChangedFrom = (base: Baseline, d: RolesDraft) =>
    JSON.stringify(roleSection(d)) !== JSON.stringify(roleSection(draftFrom(base)))
  const defaultChangedFrom = (base: Baseline, d: RolesDraft) =>
    d.defaultRole !== effectiveDefaultRole(base.autoProvisionRole)

  // The stored row changed (a save here or on another card, or a refetch). A
  // clean draft follows it; a draft with edits is kept.
  if (seen.mapping !== stored.mapping || seen.autoProvisionRole !== stored.autoProvisionRole) {
    setSeen(stored)
    setBaseline(stored)
    if (!roleChangedFrom(baseline, draft) && !defaultChangedFrom(baseline, draft)) {
      setDraft(draftFrom(stored))
    }
  }

  const roleChanged = roleChangedFrom(baseline, draft)
  const defaultChanged = defaultChangedFrom(baseline, draft)
  const dirty = roleChanged || defaultChanged
  usePublishRolesDraft(dirty ? { role: roleSection(draft), defaultRole: draft.defaultRole } : null)
  const proposed = mergeClaimMapping(baseline.mapping, { role: roleSection(draft) })
  const operations = roleChanged ? diffClaimMappingOperations(baseline.mapping, proposed) : []
  const risks = mappingSaveRisks(baseline.mapping, proposed, { adminTierRoleIds: tierIds })
  // Admin rules that already existed and did not change are acknowledged
  // silently; only new or altered ones get a confirmation.
  const adminRulesChanged =
    roleChanged &&
    risks.hasAdminRules &&
    JSON.stringify(adminRulesOf(baseline.mapping?.role, tierIds)) !==
      JSON.stringify(adminRulesOf(proposed?.role, tierIds))

  const domains = verifiedDomainNames(provider.domains)
  // A stored rule naming a missing role may stay as it is (it changes
  // nothing); one the admin adds or edits must name a role that exists.
  const editedRoleIds = roleRuleRoleIds(proposed, { newSince: baseline.mapping })
  const editedMissing = draft.rules.some((r) => roleMissing(r) && editedRoleIds.includes(r.roleId!))
  const filled =
    draft.rules.every((r) => r.whenContains.trim() !== '') &&
    (draft.rules.length === 0 || draft.claimPath.trim() !== '')
  const valid = filled && !editedMissing

  // The last test sign-in, replayed once under this draft: which raw rules its
  // person matches, the first one sign-in would apply, and the values sent.
  const proposedKey = JSON.stringify(proposed)
  const ruleMatches = useMemo(
    () => previewRoleRuleMatches(JSON.parse(proposedKey) as typeof proposed, capture),
    [proposedKey, capture]
  )
  const matches = ruleMatches?.ruleMatches ?? []
  const firstMatch = ruleMatches?.firstMatchIndex ?? -1
  const testPerson = capture ? personName(capture) : null
  const seenValues = ruleMatches?.valuesAtPath ?? []
  const firstRule = firstMatch >= 0 ? draft.rules[firstMatch] : undefined
  const testMatch = !ruleMatches
    ? undefined
    : firstRule
      ? {
          role: firstRule.role,
          ...(firstRule.roleId ? { roleId: firstRule.roleId } : {}),
          ...(roleMissing(firstRule) ? { roleMissing: true as const } : {}),
          ruleIndex: firstMatch,
        }
      : null

  const ssoManagerRoles = ssoManagerRoleIds(rolesData?.roles ?? [])
  const guardActive = provider.autoCreateUsers && draft.mode === 'every'
  const admins = useProviderAdmins(provider.id, guardActive)
  const guard = adminGuard({
    active: guardActive,
    loading: admins.isPending,
    failed: admins.isError,
    admins: admins.data,
    draft,
    domains,
    keepsIds: ssoManagerRoles,
    testEmail: capture?.identity?.email ?? null,
    testMatch,
  })
  const lockout = guard.kind === 'caller' || guard.kind === 'block' || guard.kind === 'error'
  // Off the verified domains, only a rule can change someone's role. Who matches
  // a rule without SSO management is unknown here, so they get a quiet warning.
  // The general warning already covers them when a rule can keep access.
  const offDomainAtRisk =
    guard.kind === 'none' || guard.kind === 'block' || guard.kind === 'caller'
      ? draft.rules.some(
          (r) =>
            r.whenContains.trim() !== '' &&
            !(r.roleId ? ssoManagerRoles.has(r.roleId) : r.role === 'admin')
        )
        ? (admins.data ?? []).filter((p) => p.canManageSso && !p.atVerifiedDomain).length
        : 0
      : 0
  // Save waits for the role list (so an admin-level custom role is always
  // confirmed) and, under "Every sign-in", for the admin check.
  const waiting = !rolesData
    ? 'Loading roles…'
    : guard.kind === 'loading'
      ? 'Checking admins…'
      : null

  const update = (patch: Partial<RolesDraft>) => {
    setRuleError(null)
    setSyncRefused(null)
    setDraft((prev) => ({ ...prev, ...patch }))
  }
  const updateRule = (index: number, patch: Partial<RoleRuleDraft>) => {
    setRuleError(null)
    setSyncRefused(null)
    setDraft((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, i) => {
        if (i !== index) return rule
        const next = { ...rule, ...patch }
        if (!next.roleId) delete next.roleId
        return next
      }),
    }))
  }
  const moveRule = (index: number, dir: -1 | 1) =>
    setDraft((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.rules.length) return prev
      const rules = [...prev.rules]
      const [item] = rules.splice(index, 1)
      rules.splice(target, 0, item!)
      return { ...prev, rules }
    })

  const persist = async () => {
    const both = roleChanged && defaultChanged
    if (roleChanged) {
      const saved = await saveClaimMapping(
        { operations, acknowledgeAdminRules: risks.hasAdminRules },
        both ? null : 'Roles saved.',
        (err) => {
          if (isSyncLockout(err)) {
            setSyncRefused(syncLockoutMessage(label))
            return true
          }
          const refusal = grantRefusal(err)
          // The server names no rule, but it only checks rules this save adds
          // or changes, so the refusal belongs on those.
          const roleIds = roleRuleRoleIds(proposed, { newSince: baseline.mapping })
          if (!refusal || roleIds.length === 0) return false
          setRuleError({ roleIds, message: refusal })
          return true
        }
      )
      if (!saved) return
    }
    if (defaultChanged) {
      const ok = await save({ autoProvisionRole: draft.defaultRole }, 'Roles saved.', (err) => {
        if (!isSyncLockout(err)) return false
        setSyncRefused(syncLockoutMessage(label))
        return true
      })
      if (!ok) {
        if (roleChanged) setBaseline((prev) => ({ ...prev, mapping: proposed }))
        return
      }
    }
    // The server now holds this draft. Re-seed from it so it reads as saved.
    setBaseline({
      mapping: roleChanged ? proposed : baseline.mapping,
      autoProvisionRole: defaultChanged ? draft.defaultRole : baseline.autoProvisionRole,
    })
  }

  const requestSave = () => {
    if (!dirty || lockout || !valid || waiting) return
    if (adminRulesChanged) {
      setConfirmOpen(true)
      return
    }
    void persist()
  }

  return (
    <div className="space-y-5">
      {!provider.autoCreateUsers && (
        <p className="text-sm text-muted-foreground">
          Account creation is off in Sign-in &amp; access, so these roles are not applied.
        </p>
      )}

      <div className="space-y-2.5">
        {draft.rules.length > 0 && (
          // Every rule reads the same claim, so it is chosen once, above them.
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Claim</span>
            <div className="w-56">
              <ClaimPathInput
                value={draft.claimPath}
                onChange={(claimPath) => update({ claimPath })}
                registrationId={provider.registrationId}
                canTest
                placeholder="groups"
                ariaLabel="Claim to check"
                disabled={saving}
                capture={capture}
                suggestionsFor="role"
                className={NEUTRAL_BUTTON_FOCUS}
              />
            </div>
          </div>
        )}
        {draft.rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
            No rules yet. Everyone gets the roles below. Add a rule to give a role based on a claim
            such as groups.
          </p>
        ) : (
          <ol aria-label="Role rules" className="space-y-2.5">
            {draft.rules.map((rule, index) => (
              <li
                key={index}
                className={cn(
                  'rounded-lg border px-3 py-2.5',
                  index === firstMatch ? 'border-success/30 bg-success/5' : 'border-border/60'
                )}
              >
                <div
                  data-testid="rule-sentence"
                  className="flex flex-wrap items-center gap-2 text-sm sm:flex-nowrap"
                >
                  <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground">If</span>
                  <code
                    title={draft.claimPath.trim()}
                    className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                  >
                    {draft.claimPath.trim() || 'claim'}
                  </code>
                  <span className="text-muted-foreground">contains</span>
                  <Autocomplete
                    value={rule.whenContains}
                    onValueChange={(whenContains) => updateRule(index, { whenContains })}
                    suggestions={seenValues.map((value) => ({ value }))}
                    ariaLabel={`Value for rule ${index + 1}`}
                    placeholder="value"
                    emptyHint="No values seen yet. Type the value to match."
                    disabled={saving}
                    size="sm"
                    className={cn('w-40 shrink-0', NEUTRAL_BUTTON_FOCUS)}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                  <RuleRoleSelect
                    rule={rule}
                    index={index}
                    customRoles={customRoles}
                    namedRole={
                      rule.roleId
                        ? (liveRoles?.find((r) => r.id === rule.roleId)?.name ??
                          (roleMissing(rule) ? 'Missing role' : 'Custom role'))
                        : undefined
                    }
                    disabled={saving}
                    onChange={(patch) => updateRule(index, patch)}
                  />
                  <div className="ml-auto flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn('h-8 px-2', NEUTRAL_BUTTON_FOCUS)}
                      aria-label={`Move rule ${index + 1} up`}
                      onClick={() => moveRule(index, -1)}
                      disabled={saving || index === 0}
                    >
                      <ChevronUpIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn('h-8 px-2', NEUTRAL_BUTTON_FOCUS)}
                      aria-label={`Move rule ${index + 1} down`}
                      onClick={() => moveRule(index, 1)}
                      disabled={saving || index === draft.rules.length - 1}
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn('h-8 px-2', NEUTRAL_BUTTON_FOCUS)}
                      aria-label={`Remove rule ${index + 1}`}
                      onClick={() => update({ rules: draft.rules.filter((_, i) => i !== index) })}
                      disabled={saving}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {roleMissing(rule) && (
                  <p className="mt-1.5 pl-6 text-xs text-warning">{MISSING_ROLE_NOTE}</p>
                )}
                {rule.roleId && ruleError?.roleIds.includes(rule.roleId) && (
                  <p role="alert" className="mt-1.5 pl-6 text-xs text-destructive">
                    {ruleError.message}
                  </p>
                )}
                {matches[index] && testPerson && (
                  <p
                    className={cn(
                      'mt-1.5 pl-6 text-xs',
                      index === firstMatch ? 'text-success' : 'text-muted-foreground'
                    )}
                  >
                    Matches {testPerson} in the last test sign-in
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('gap-1.5', NEUTRAL_BUTTON_FOCUS)}
          onClick={() => update({ rules: [...draft.rules, { whenContains: '', role: 'member' }] })}
          disabled={saving}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add rule
        </Button>

        {seenValues.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Values seen in the last test sign-in:
            {seenValues.map((value) => (
              <span
                key={value}
                className="rounded-full bg-muted px-2 py-0.5 font-mono text-foreground"
              >
                {value}
              </span>
            ))}
          </p>
        )}
      </div>

      <OtherwiseBlock
        domains={domains}
        defaultRole={draft.defaultRole}
        disabled={saving}
        onDefaultRoleChange={(defaultRole) => update({ defaultRole })}
      />

      <WhenApplied
        label={label}
        mode={draft.mode}
        disabled={saving}
        onChange={(mode) => update({ mode })}
      />

      {guard.kind === 'error' && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>Couldn&apos;t check which admins sign in with {label}. Try again.</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={NEUTRAL_BUTTON_FOCUS}
              onClick={() => void admins.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {syncRefused && (
        <Alert variant="destructive">
          <AlertDescription>{syncRefused}</AlertDescription>
        </Alert>
      )}
      {guard.kind === 'caller' && (
        <Alert variant="destructive">
          <AlertTitle>This would remove admin access from you.</AlertTitle>
          <AlertDescription>
            You sign in with {label} and no rule gives you Admin. Add a rule that matches you, or
            keep &ldquo;First sign-in only&rdquo;.
          </AlertDescription>
        </Alert>
      )}
      {guard.kind === 'block' && (
        <Alert variant="destructive">
          <AlertTitle>{blockTitle(guard.people)}</AlertTitle>
          <AlertDescription>
            <p>
              They sign in with {label} and no rule gives Admin. Add a rule that gives Admin, or
              keep &ldquo;First sign-in only&rdquo;.
            </p>
            <ul aria-label="Admins who would lose access" className="list-disc pl-4">
              {guard.people.map((p) => (
                <li key={p.principalId}>{personLabel(p)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {offDomainAtRisk > 0 && (
        <Alert role="status" className="text-warning">
          <AlertDescription className="text-warning">
            {offDomainAtRisk === 1
              ? '1 admin outside your verified domains signs in'
              : `${offDomainAtRisk} admins outside your verified domains sign in`}{' '}
            with {label}. If one matches a rule that does not give Admin, they lose admin access at
            their next sign-in.
          </AlertDescription>
        </Alert>
      )}
      {guard.kind === 'warn' && (
        <Alert role="status" className="text-warning">
          <AlertDescription className="text-warning">
            {guard.count === 1 ? '1 admin signs in' : `${guard.count} admins sign in`} with {label}.
            Make sure each one matches a rule that gives Admin, or they lose admin access at their
            next sign-in.
          </AlertDescription>
        </Alert>
      )}

      {dirty && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-5">
          {waiting && valid && <p className="mr-auto text-sm text-muted-foreground">{waiting}</p>}
          {!valid && (
            <p className="mr-auto text-sm text-muted-foreground">
              {filled
                ? 'Pick a role that exists for the rules you changed.'
                : 'Each rule needs a claim and a value.'}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={NEUTRAL_BUTTON_FOCUS}
            onClick={() => setDraft(draftFrom(baseline))}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className={NEUTRAL_BUTTON_FOCUS}
            onClick={requestSave}
            disabled={saving || lockout || !valid || waiting !== null}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm these changes"
        confirmLabel="Save changes"
        description={
          <p className="text-sm">
            {risks.adminRules.length === 1
              ? 'A rule grants admin access.'
              : `${risks.adminRules.length} rules grant admin access.`}{' '}
            Matching users become admins even when their email is outside this provider&apos;s
            verified domains.
          </p>
        }
        onConfirm={() => {
          setConfirmOpen(false)
          void persist()
        }}
      />
    </div>
  )
}

/** Whether the server refused "Every sign-in" because it would lock admins out. */
function isSyncLockout(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'SYNC_LOCKOUT' || (err instanceof Error && /SYNC_LOCKOUT/.test(err.message))
}

function syncLockoutMessage(label: string): string {
  return `Saving this would remove admin access from people who sign in with ${label}. Add a rule that gives Admin, or keep “First sign-in only”.`
}

/** The plain-English reason a save that grants a role was refused, or null. */
function grantRefusal(err: unknown): string | null {
  const code =
    typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : ''
  const message = err instanceof Error ? err.message : ''
  if (
    code === 'ROLE_RULE_UNKNOWN_ROLE' ||
    /ROLE_RULE_UNKNOWN_ROLE|no longer exists/.test(message)
  ) {
    return 'This role no longer exists. Pick another role.'
  }
  if (
    code === 'GRANT_CEILING' ||
    /GRANT_CEILING|permissions you don.t hold|Assigner permission/.test(message)
  ) {
    return "You can't give this role: it has permissions you don't hold."
  }
  return null
}

function personName(capture: SsoTestCapture): string {
  return capture.identity?.name?.trim() || captureIdentityCaption(capture)
}

type AdminGuard =
  | { kind: 'none' }
  | { kind: 'loading' }
  /** The admin list could not be read, so nothing vouches for the change. */
  | { kind: 'error' }
  /** The caller's own last test sign-in shows they would lose SSO management. */
  | { kind: 'caller' }
  /** People sign-in would demote: at a verified domain, with no rule that can keep them. */
  | { kind: 'block'; people: ProviderAdmin[] }
  /** Some rule can keep them; whether each one matches it is unknown here. */
  | { kind: 'warn'; count: number }

/**
 * Whether saving "Every sign-in" would take SSO management away from the
 * people who sign in with this provider and hold it now, mirroring sign-in:
 * without a matching rule, only someone at a verified domain gets the default
 * role; anyone else is left alone. Their claims are unknown here, so a draft
 * with no rule able to keep them (and a default that is not Admin) blocks for
 * those at a verified domain, and one with such a rule only warns. When the
 * last test sign-in was the caller's own, their claims decide it exactly.
 */
function adminGuard({
  active,
  loading,
  failed,
  admins,
  draft,
  domains,
  keepsIds,
  testEmail,
  testMatch,
}: {
  active: boolean
  loading: boolean
  failed: boolean
  admins: ProviderAdmin[] | undefined
  draft: RolesDraft
  domains: string[]
  /** Custom roles that hold SSO management: a rule giving one keeps it. */
  keepsIds: ReadonlySet<string>
  /** The test person's email, and the raw rule they match first (undefined: no test). */
  testEmail: string | null
  testMatch:
    { role: Role; roleId?: string; roleMissing?: true; ruleIndex: number } | null | undefined
}): AdminGuard {
  if (!active) return { kind: 'none' }
  if (failed) return { kind: 'error' }
  if (loading) return { kind: 'loading' }
  const people = (admins ?? []).filter((p) => p.canManageSso)
  const keeps = (role: Role, roleId?: string) => (roleId ? keepsIds.has(roleId) : role === 'admin')
  const caller = people.find((p) => p.isCaller)
  if (
    caller?.email &&
    testMatch !== undefined &&
    testEmail?.toLowerCase() === caller.email.toLowerCase()
  ) {
    const outcome = signInRoleOutcome({
      ruleMatch: testMatch,
      email: caller.email,
      verifiedDomains: domains,
      defaultRole: draft.defaultRole,
    })
    const loses =
      outcome.source === 'rule'
        ? !keeps(outcome.role, outcome.roleId)
        : outcome.source === 'domain' && outcome.role !== 'admin'
    if (loses) return { kind: 'caller' }
  }
  if (people.length === 0) return { kind: 'none' }
  const ruleKeeps = draft.rules.some((r) => r.whenContains.trim() !== '' && keeps(r.role, r.roleId))
  if (ruleKeeps) return { kind: 'warn', count: people.length }
  if (draft.defaultRole === 'admin') return { kind: 'none' }
  const demoted = people.filter((p) => p.atVerifiedDomain)
  return demoted.length > 0 ? { kind: 'block', people: demoted } : { kind: 'none' }
}

function personLabel(p: ProviderAdmin): string {
  const name = p.name?.trim() || p.email || 'Unnamed teammate'
  return p.isCaller ? `${name} (you)` : name
}

function blockTitle(people: ProviderAdmin[]): string {
  const includesCaller = people.some((p) => p.isCaller)
  if (people.length === 1 && includesCaller) return 'This would remove admin access from you.'
  const count = `${people.length} ${people.length === 1 ? 'person' : 'people'}`
  return `This would remove admin access from ${count}${includesCaller ? ', including you' : ''}.`
}

function RuleRoleSelect({
  rule,
  index,
  customRoles,
  namedRole,
  disabled,
  onChange,
}: {
  rule: RoleRuleDraft
  index: number
  customRoles: Array<{ id: string; name: string }>
  /** The name to show for a rule's role that is not a custom role on offer
   *  (a preset named by id, or one that no longer exists). */
  namedRole?: string
  disabled: boolean
  onChange: (patch: Partial<RoleRuleDraft>) => void
}) {
  const value = rule.roleId ? `${CUSTOM_PREFIX}${rule.roleId}` : rule.role
  const unknownCustom = rule.roleId && !customRoles.some((r) => r.id === rule.roleId)
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next.startsWith(CUSTOM_PREFIX)) {
          // Custom roles ride the member tier plus the role grant.
          onChange({ role: 'member', roleId: next.slice(CUSTOM_PREFIX.length) })
        } else {
          onChange({ role: next as Role, roleId: undefined })
        }
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={cn('w-36 shrink-0', NEUTRAL_SELECT_FOCUS)}
        aria-label={`Role for rule ${index + 1}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Presets</SelectLabel>
          {PRESETS.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_PRESET_LABELS[role]}
            </SelectItem>
          ))}
        </SelectGroup>
        {(customRoles.length > 0 || unknownCustom) && (
          <SelectGroup>
            <SelectLabel>Custom roles</SelectLabel>
            {customRoles.map((role) => (
              <SelectItem key={role.id} value={`${CUSTOM_PREFIX}${role.id}`}>
                {role.name}
              </SelectItem>
            ))}
            {unknownCustom && <SelectItem value={value}>{namedRole ?? 'Custom role'}</SelectItem>}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  )
}

function OtherwiseBlock({
  domains,
  defaultRole,
  disabled,
  onDefaultRoleChange,
}: {
  domains: string[]
  defaultRole: Role
  disabled: boolean
  onDefaultRoleChange: (role: Role) => void
}) {
  return (
    <div className="space-y-3 border-t border-border/40 pt-5 text-sm">
      <h3 className="font-medium">Otherwise</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {domains.length > 0 ? (
            <>
              {'People with an email at '}
              {domains.map((name) => (
                <span key={name} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                  {name}
                </span>
              ))}
            </>
          ) : (
            'People at a verified domain'
          )}
        </span>
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <Select
          value={defaultRole}
          onValueChange={(role) => onDefaultRoleChange(role as Role)}
          disabled={disabled}
        >
          <SelectTrigger
            size="sm"
            className={cn('w-36', NEUTRAL_SELECT_FOCUS)}
            aria-label="Role for people at a verified domain"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((role) => (
              <SelectItem key={role} value={role}>
                {ROLE_PRESET_LABELS[role]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {domains.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This provider has no verified domain yet.{' '}
          <a href="#signin" className={cn(INLINE_LINK, NEUTRAL_LINK_FOCUS)}>
            Add one in Sign-in &amp; access
          </a>
          . Until then, only rules give team roles.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1">Everyone else</span>
        <span aria-hidden="true" className="text-muted-foreground">
          →
        </span>
        <span className="w-36 px-1 text-muted-foreground">Portal user</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Portal users can post, vote and comment, with no access to the team workspace.
      </p>
    </div>
  )
}

const MODES: Array<{ value: Mode; title: string; body: (label: string) => string }> = [
  {
    value: 'first',
    title: 'First sign-in only',
    body: () =>
      'Gives a role the first time someone signs in or matches a rule. Never removes a role.',
  },
  {
    value: 'every',
    title: 'Every sign-in',
    body: (label) =>
      `Keeps roles in step with ${label}. Someone who stops matching loses their team role at their next sign-in.`,
  },
]

function WhenApplied({
  label,
  mode,
  disabled,
  onChange,
}: {
  label: string
  mode: Mode
  disabled: boolean
  onChange: (mode: Mode) => void
}) {
  const id = useId()
  return (
    <div className="space-y-3 border-t border-border/40 pt-5 text-sm">
      <h3 id={`${id}-heading`} className="font-medium">
        When roles are applied
      </h3>
      <RadioGroup
        value={mode}
        onValueChange={(value) => onChange(value as Mode)}
        aria-labelledby={`${id}-heading`}
        disabled={disabled}
        className="gap-3"
      >
        {MODES.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-3">
            <RadioGroupItem
              value={option.value}
              aria-describedby={`${id}-${option.value}`}
              className={cn('mt-0.5', NEUTRAL_FOCUS)}
            />
            <span className="space-y-0.5">
              <span className="block font-medium">{option.title}</span>
              <span id={`${id}-${option.value}`} className="block text-muted-foreground">
                {option.body(label)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}
