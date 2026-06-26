/**
 * Identity-provider editor (per spec §11.3 / §11.4).
 *
 * One dialog edits (or creates) a single OIDC identity provider. It is the
 * per-provider successor to the old single-SSO page sections: it absorbs the
 * connection form (`sso-connection-section`), the verified-domain table
 * (`verified-domains-section`), the attribute→role mapping
 * (`attribute-mapping-section`) and the "Test sign-in" affordance — but each
 * is rewired from the single `authConfig.ssoOidc` blob onto the Task 15
 * per-provider server fns (`upsertIdentityProviderFn`,
 * `setProviderCredentialsFn`, `addProviderDomainFn`, `verifyProviderDomainFn`,
 * `setDomainEnforcedFn`).
 *
 * The domain→visibility rule (D5) shows up here twice:
 *  - the "Also show a 'Sign in with X' button" toggle renders ONLY when the
 *    provider has ≥1 verified domain — a domain-less provider is always a
 *    public button, so the toggle would be meaningless.
 *  - per-domain enforcement is a checkbox guarded by a precondition warning.
 */
import { useState, useEffect } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useRouteContext } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircleIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
  AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/solid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { WarningBox } from '@/components/shared/warning-box'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { RadioGroup } from '@/components/ui/radio-group'
import { IdpLogo } from '@/components/icons/idp-provider-icons'
import { cn } from '@/lib/shared/utils'
import { CopyButton } from '@/components/shared/copy-button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  addProviderDomainFn,
  deleteIdentityProviderFn,
  removeVerifiedDomainFn,
  setDomainEnforcedFn,
  setProviderCredentialsFn,
  upsertIdentityProviderFn,
  verifyProviderDomainFn,
  type VerifyDomainResult,
} from '@/lib/server/functions/sso'
import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { VerifiedDomain } from '@/lib/server/domains/settings/settings.types'
import { getIdpShortcut, inferIdpKind, IDP_KIND_NAMES, type IdpKind } from '../idp-shortcuts'
import { TestSignInButton } from '../sso/test-sign-in-button'
import { useSsoTestSignIn } from '../sso/use-sso-test-sign-in'
import { deriveClaimSuggestions } from '@/lib/shared/claim-suggestions'
import { Autocomplete } from '@/components/ui/autocomplete'

type Role = 'admin' | 'member' | 'user'
type Mapping = NonNullable<IdentityProvider['attributeMapping']>

const ROLES: Role[] = ['admin', 'member', 'user']
const IDENTITY_PROVIDERS_KEY = ['settings', 'identityProviders'] as const

const IDP_KIND_OPTIONS: IdpKind[] = ['okta', 'auth0', 'entra', 'keycloak', 'google', 'other']

const VERIFY_REASON_MESSAGES: Record<
  Exclude<VerifyDomainResult, { verified: true }>['reason'],
  string
> = {
  'no-record':
    "Couldn't find a TXT record at that name. Add the record above and wait for DNS propagation, then try again.",
  mismatch:
    "Found a TXT record but the value didn't match. Double-check the value (it should start with `qb-domain-verify=`).",
  'lookup-failed': 'DNS lookup failed. Try again in a moment.',
  'no-pending-domain': 'No pending domain to verify.',
}

/** All OIDC providers register under the genericOAuth callback path. The
 *  admin copies this into their IdP's allowed-redirect list. */
function redirectUriFor(baseUrl: string | undefined, registrationId: string): string {
  // Build from the SERVER's configured base URL (what Better-Auth actually uses
  // for the OAuth redirect_uri), not window.location.origin — those diverge
  // behind a proxy/tunnel (e.g. ngrok) and a mismatch breaks the OAuth flow.
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin.replace(/\/+$/, '')}/api/auth/oauth2/callback/${registrationId}`
}

/** New providers get an `oidc_<id>` registrationId (stable across the
 *  migration; drives the redirect URI + `account.provider_id`). */
function newRegistrationId(): string {
  return `oidc_${Math.random().toString(36).slice(2, 10)}`
}

/** Connection-test freshness from the provider's last successful test vs. its
 *  last redirect-affecting change. Drives the connection status line and the
 *  enforcement-unlock gate — only `verified` may turn enforcement on. Mirrors
 *  the server-side `isSsoEnforcementUnlocked(provider, null)` predicate. */
type ConnectionTestState =
  | { kind: 'unsaved' | 'untested' | 'stale' }
  | { kind: 'verified'; testedAt: string }

function getConnectionTestState(provider: IdentityProvider | null): ConnectionTestState {
  if (!provider) return { kind: 'unsaved' }
  const testedMs = provider.lastSuccessfulTestAt
    ? new Date(provider.lastSuccessfulTestAt).getTime()
    : null
  if (testedMs === null || Number.isNaN(testedMs)) return { kind: 'untested' }
  const changedMs = provider.detailsChangedAt ? new Date(provider.detailsChangedAt).getTime() : null
  if (changedMs !== null && !Number.isNaN(changedMs) && testedMs <= changedMs) {
    return { kind: 'stale' }
  }
  return { kind: 'verified', testedAt: provider.lastSuccessfulTestAt! }
}

export function ProviderEditor({
  provider,
  open,
  onOpenChange,
  onSaved,
  isOnlyMethod = false,
}: {
  /** Existing provider to edit, or null to create a new one. */
  provider: IdentityProvider | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a successful create/update with the saved provider so the
   *  parent can keep the dialog open on the now-persisted row. */
  onSaved?: (saved: IdentityProvider) => void
  /** True when this provider is the workspace's only working sign-in method —
   *  removing it would lock everyone out, so the Remove action is blocked
   *  (the server enforces the same invariant as a backstop). */
  isOnlyMethod?: boolean
}) {
  const queryClient = useQueryClient()
  const upsert = useServerFn(upsertIdentityProviderFn)
  const setCreds = useServerFn(setProviderCredentialsFn)
  const remove = useServerFn(deleteIdentityProviderFn)
  const { baseUrl } = useRouteContext({ from: '__root__' })

  // Stable for this editor session: existing providers keep their id; a new
  // provider gets one generated once so the redirect URI shown below is the
  // exact value that gets saved (and registered at the IdP), not a placeholder.
  const [registrationId] = useState(() => provider?.registrationId ?? newRegistrationId())

  const [label, setLabel] = useState(provider?.label ?? '')
  // Prefer the persisted shortcut choice; fall back to inferring it from the
  // discovery URL only for legacy rows saved before `kind` was stored (a
  // vanity domain infers as "Custom OIDC" even when it is really Okta/Entra).
  const [kind, setKind] = useState<IdpKind>(
    () => provider?.kind ?? inferIdpKind(provider?.discoveryUrl)
  )
  const [discoveryUrl, setDiscoveryUrl] = useState(provider?.discoveryUrl ?? '')
  // Manual endpoints for an IdP with no discovery document. authorization +
  // token are needed to sign in; jwks + issuer additionally let the SSO test
  // verify the ID token (and thus unlock enforcement). Only surfaced for the
  // "Other" kind — the shortcut kinds always build a discovery URL.
  const [manual, setManual] = useState({
    authorizationUrl: provider?.authorizationUrl ?? '',
    tokenUrl: provider?.tokenUrl ?? '',
    userInfoUrl: provider?.userInfoUrl ?? '',
    jwksUri: provider?.jwksUri ?? '',
    issuer: provider?.issuer ?? '',
  })
  const [clientId, setClientId] = useState(provider?.clientId ?? '')
  const [secretDraft, setSecretDraft] = useState('')
  // Enabling/disabling lives on the provider list row now; the editor only
  // preserves the existing value so saving other fields never flips it. The
  // editor is keyed per provider, so this is stable for the dialog's lifetime.
  const enabled = provider?.enabled ?? false
  const [autoCreateUsers, setAutoCreateUsers] = useState(provider?.autoCreateUsers ?? true)
  const [autoProvisionRole, setAutoProvisionRole] = useState<Role>(
    provider?.autoProvisionRole ?? 'user'
  )
  const [showButton, setShowButton] = useState(provider?.showButton ?? false)
  const [mapping, setMapping] = useState<Mapping | null>(provider?.attributeMapping ?? null)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const verifiedDomainCount = (provider?.domains ?? []).filter((d) => d.verifiedAt).length
  const hasVerifiedDomain = verifiedDomainCount > 0

  const handleSave = async () => {
    if (!label.trim()) {
      toast.error('Display name is required.')
      return
    }
    if (!clientId.trim()) {
      toast.error('Client ID is required.')
      return
    }
    // A claim mapping with no rules and no sign-in sync does nothing, so persist
    // null (the canonical "no mapping" state). A custom claim path alone is inert.
    const mappingToSave =
      mapping && (mapping.rules.length > 0 || mapping.syncOnEverySignIn === true) ? mapping : null
    setSaving(true)
    try {
      const saved = await upsert({
        data: {
          id: provider?.id,
          registrationId,
          label: label.trim(),
          // Persist the selected family so the editor reopens on the right
          // tile regardless of what the discovery URL would infer.
          kind,
          clientId: clientId.trim(),
          discoveryUrl: discoveryUrl.trim() || null,
          // Manual endpoints only apply to "Other"; null them out otherwise so
          // switching back to a shortcut kind clears any stale manual config.
          authorizationUrl: kind === 'other' ? manual.authorizationUrl.trim() || null : null,
          tokenUrl: kind === 'other' ? manual.tokenUrl.trim() || null : null,
          userInfoUrl: kind === 'other' ? manual.userInfoUrl.trim() || null : null,
          jwksUri: kind === 'other' ? manual.jwksUri.trim() || null : null,
          issuer: kind === 'other' ? manual.issuer.trim() || null : null,
          enabled,
          autoCreateUsers,
          // Role only applies when auto-create is on; null it out otherwise
          // so a stale role doesn't linger on a provisioning-off provider.
          autoProvisionRole: autoCreateUsers ? autoProvisionRole : null,
          attributeMapping: mappingToSave,
          showButton,
        },
      })
      if (secretDraft.trim()) {
        await setCreds({ data: { id: saved.id, clientSecret: secretDraft.trim() } })
        setSecretDraft('')
      }
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Identity provider saved.')
      // Editing closes; creating hands the saved row up so the parent can
      // reopen on it (domains/visibility need a persisted id).
      if (provider) {
        onOpenChange(false)
      } else {
        onSaved?.(saved)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the identity provider.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!provider) return
    setSaving(true)
    try {
      await remove({ data: { id: provider.id } })
      await queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })
      toast.success('Identity provider removed.')
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the identity provider.')
    } finally {
      setSaving(false)
      setDeleteOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (saving ? undefined : onOpenChange(o))}>
      <DialogContent className="flex h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
          <DialogTitle>{provider ? 'Edit identity provider' : 'Add identity provider'}</DialogTitle>
          <DialogDescription>
            Connect an OpenID Connect IdP for portal and admin sign-in.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-6 px-6 py-5">
            {/* Display name */}
            <div className="space-y-2">
              <Label htmlFor="idp-label">Display name</Label>
              <Input
                id="idp-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Acme SSO"
                disabled={saving}
              />
              {label.trim() && (
                <p className="text-xs text-muted-foreground">
                  Button reads: &ldquo;Sign in with {label.trim()}&rdquo;
                </p>
              )}
            </div>

            {/* Identity provider picker + discovery */}
            <div className="space-y-3">
              <Label>Identity provider</Label>
              <RadioGroup
                value={kind}
                onValueChange={(v) => {
                  const next = v as IdpKind
                  setKind(next)
                  // Fixed-discovery kinds (Google) have no shortcut input — seed
                  // the canonical URL now so the saved row is well-formed without
                  // a render-time state write.
                  const def = getIdpShortcut(next)
                  if (next !== 'other' && def.fields.length === 0) {
                    const url = def.build({})
                    if (url) setDiscoveryUrl(url)
                  }
                }}
                className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
              >
                {IDP_KIND_OPTIONS.map((k) => (
                  <RadioGroupPrimitive.Item
                    key={k}
                    value={k}
                    id={`idp-kind-${k}`}
                    disabled={saving}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg border border-border/50 bg-card p-3 text-left shadow-sm outline-none transition-all',
                      'hover:border-border hover:bg-accent/40',
                      'focus-visible:ring-2 focus-visible:ring-ring/50',
                      'data-[state=checked]:border-primary data-[state=checked]:ring-2 data-[state=checked]:ring-primary/30',
                      'disabled:cursor-not-allowed disabled:opacity-60'
                    )}
                  >
                    <IdpLogo
                      kind={k}
                      className="h-8 w-8 shrink-0"
                      iconClassName="h-[18px] w-[18px]"
                    />
                    <span className="truncate text-sm font-medium">{IDP_KIND_NAMES[k]}</span>
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroup>
              <IdpDiscoveryFields
                kind={kind}
                discoveryUrl={discoveryUrl}
                disabled={saving}
                onChange={setDiscoveryUrl}
              />
              {kind === 'other' && (
                <ManualEndpointsSection
                  values={manual}
                  disabled={saving}
                  onChange={(patch) => setManual((m) => ({ ...m, ...patch }))}
                />
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="idp-client-id">Client ID</Label>
              <Input
                id="idp-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="idp-client-secret">Client secret</Label>
              <Input
                id="idp-client-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secretDraft}
                onChange={(e) => setSecretDraft(e.target.value)}
                placeholder={provider ? 'Leave blank to keep the current secret' : ''}
                disabled={saving}
              />
            </div>

            <RedirectUriCallout uri={redirectUriFor(baseUrl, registrationId)} />

            {/* Connection test — the capstone of the connection block. A
              successful test validates discovery + credentials + the registered
              redirect URI, and is the precondition that unlocks enforcement. */}
            <ConnectionTestRow
              provider={provider}
              registrationId={registrationId}
              disabled={saving}
            />

            {/* Domains */}
            <DomainsSection provider={provider} disabled={saving} />

            {/* Visibility — only meaningful once a verified domain routes by
              default; a domain-less provider is always a public button. */}
            {hasVerifiedDomain && (
              <div className="space-y-2 border-t border-border/40 pt-5">
                <Label className="font-medium">Visibility</Label>
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={showButton}
                    onCheckedChange={(v) => setShowButton(v === true)}
                    disabled={saving}
                    aria-label="Also show a sign-in button"
                    className="mt-0.5"
                  />
                  <span>
                    Also show a &ldquo;Sign in with {label.trim() || 'this provider'}&rdquo; button
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Off = routed only; hidden from the public portal.
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Provisioning */}
            <div className="space-y-4 border-t border-border/40 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <Label className="font-medium">Auto-create accounts on first sign-in</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create an account the first time someone signs in through this provider.
                  </p>
                </div>
                <Switch
                  checked={autoCreateUsers}
                  onCheckedChange={setAutoCreateUsers}
                  disabled={saving}
                  aria-label="Auto-create accounts on first sign-in"
                  className="mt-0.5 shrink-0"
                />
              </div>

              {autoCreateUsers && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="idp-default-role" className="font-medium">
                      Default role
                    </Label>
                    <Select
                      value={autoProvisionRole}
                      onValueChange={(r) => setAutoProvisionRole(r as Role)}
                      disabled={saving}
                    >
                      <SelectTrigger
                        id="idp-default-role"
                        className="w-[220px]"
                        aria-label="Default role"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="user">User (portal only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      New users get this role unless a rule below matches one of their claims.
                    </p>
                  </div>

                  <ClaimMappingEditor
                    mapping={mapping}
                    disabled={saving}
                    registrationId={registrationId}
                    canTest={!!provider}
                    onChange={setMapping}
                  />
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="shrink-0 items-center border-t border-border/50 px-6 py-4 sm:justify-between">
          {provider ? (
            <span
              title={
                isOnlyMethod
                  ? 'This is the only enabled sign-in method. Enable another before removing it.'
                  : undefined
              }
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={saving || isOnlyMethod}
              >
                <TrashIcon className="mr-1.5 h-4 w-4" />
                Remove
              </Button>
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {provider && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Remove ${provider.label}?`}
          description="Sign-in through this provider stops working and its verified domains are released."
          variant="destructive"
          confirmLabel="Remove"
          isPending={saving}
          onConfirm={handleDelete}
        />
      )}
    </Dialog>
  )
}

/**
 * IdP-aware discovery inputs — per-kind shortcut fields (Okta domain, Entra
 * tenant, Keycloak base+realm) build the canonical discovery URL; `other`
 * takes the raw URL; `google` is a fixed URL with no input. Lifted from the
 * single-SSO `sso-connection-section` and made standalone.
 */
function IdpDiscoveryFields({
  kind,
  discoveryUrl,
  disabled,
  onChange,
}: {
  kind: IdpKind
  discoveryUrl: string
  disabled: boolean
  onChange: (url: string) => void
}) {
  const def = getIdpShortcut(kind)
  const [draft, setDraft] = useState<Record<string, string>>({})

  if (kind === 'other') {
    return (
      <div className="space-y-2">
        <Label htmlFor="idp-discovery">Discovery URL</Label>
        <Input
          id="idp-discovery"
          value={discoveryUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://your-idp/.well-known/openid-configuration"
          disabled={disabled}
        />
      </div>
    )
  }

  if (def.fields.length === 0) {
    // Google: fixed discovery URL, seeded by the kind selector. No input.
    return null
  }

  const parsed = def.parse(discoveryUrl)
  const values = parsed ?? draft
  const apply = (next: Record<string, string>) => {
    setDraft(next)
    const url = def.build(next)
    if (url) onChange(url)
  }

  return (
    <div className="space-y-3">
      {def.fields.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={`idp-field-${f.key}`}>{f.label}</Label>
          <Input
            id={`idp-field-${f.key}`}
            value={values[f.key] ?? ''}
            onChange={(e) => apply({ ...values, [f.key]: e.target.value })}
            placeholder={f.placeholder}
            disabled={disabled}
          />
          {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
        </div>
      ))}
    </div>
  )
}

type ManualEndpoints = {
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  jwksUri: string
  issuer: string
}

/**
 * Manual OIDC endpoints for an IdP with no discovery document. Authorization +
 * Token are the minimum to sign in; adding JWKS URI + Issuer lets the SSO test
 * verify the ID token, which is what unlocks domain enforcement. Collapsed by
 * default; auto-expanded when the provider already has any manual endpoint set.
 */
function ManualEndpointsSection({
  values,
  disabled,
  onChange,
}: {
  values: ManualEndpoints
  disabled: boolean
  onChange: (patch: Partial<ManualEndpoints>) => void
}) {
  const hasAny = Object.values(values).some((v) => v.trim() !== '')
  const [open, setOpen] = useState(hasAny)

  const fields: { key: keyof ManualEndpoints; label: string; placeholder: string }[] = [
    {
      key: 'authorizationUrl',
      label: 'Authorization URL',
      placeholder: 'https://your-idp/authorize',
    },
    { key: 'tokenUrl', label: 'Token URL', placeholder: 'https://your-idp/token' },
    { key: 'jwksUri', label: 'JWKS URI', placeholder: 'https://your-idp/.well-known/jwks.json' },
    { key: 'issuer', label: 'Issuer', placeholder: 'https://your-idp/' },
    {
      key: 'userInfoUrl',
      label: 'User info URL (optional)',
      placeholder: 'https://your-idp/userinfo',
    },
  ]

  return (
    <div className="rounded-md border border-border/50 bg-muted/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <span>Manual endpoints (no discovery URL)</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/40 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Use these only if your IdP has no discovery document. Authorization + Token are required
            to sign in; add JWKS URI + Issuer to enable the SSO test (and domain enforcement).
          </p>
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`idp-manual-${f.key}`} className="text-xs">
                {f.label}
              </Label>
              <Input
                id={`idp-manual-${f.key}`}
                value={values[f.key]}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                placeholder={f.placeholder}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Redirect URI the admin must register at their IdP. Per-provider: built
 *  from the provider's `registrationId`. */
function RedirectUriCallout({ uri }: { uri: string }) {
  return (
    <div className="space-y-1">
      <Label>Redirect URI to register in your IdP</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono text-xs break-all">
          {uri}
        </code>
        <CopyButton value={uri} aria-label="Copy redirect URI" />
      </div>
      <p className="text-xs text-muted-foreground">
        Add this exact URI to your IdP&apos;s allowed redirect / callback URIs.
      </p>
    </div>
  )
}

/**
 * Connection-test capstone for the connection block: one "Test sign-in" action
 * plus a status line reflecting whether the connection is verified, never
 * tested, or stale since the last config change. A fresh successful test is
 * what unlocks SSO enforcement, so the row names that payoff.
 */
function ConnectionTestRow({
  provider,
  registrationId,
  disabled,
}: {
  provider: IdentityProvider | null
  registrationId: string
  disabled: boolean
}) {
  const state = getConnectionTestState(provider)
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <Label className="font-medium">Connection</Label>
        <div className="mt-1 text-xs">
          {state.kind === 'unsaved' && (
            <span className="text-muted-foreground">
              Save the provider first, then sign in through it to verify the connection.
            </span>
          )}
          {state.kind === 'untested' && (
            <span className="text-muted-foreground">
              Not tested yet. Sign in through this provider to verify it. Required before you can
              enforce SSO.
            </span>
          )}
          {state.kind === 'verified' && (
            <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircleIcon className="size-3.5 shrink-0" />
              Verified <TimeAgo date={state.testedAt} />, ready to enforce SSO.
            </span>
          )}
          {state.kind === 'stale' && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <ClockIcon className="size-3.5 shrink-0" />
              Connection changed since the last test. Re-test to enforce SSO.
            </span>
          )}
        </div>
      </div>
      <TestSignInButton registrationId={registrationId} disabled={disabled || !provider} />
    </div>
  )
}

/**
 * Per-provider verified-domain list. Rewires `verified-domains-section` from
 * the workspace-wide single-SSO queries onto the provider's own `domains[]`
 * and the per-provider domain fns. No domains => the provider is a public
 * button; the precondition warning + enforce checkbox only matter once a
 * domain is verified.
 */
function DomainsSection({
  provider,
  disabled,
}: {
  provider: IdentityProvider | null
  disabled: boolean
}) {
  const queryClient = useQueryClient()
  const addDomain = useServerFn(addProviderDomainFn)
  const [draftName, setDraftName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const domains = provider?.domains ?? []
  const hasVerified = domains.some((d) => d.verifiedAt)
  // Enforcement is available once the provider has a fresh test sign-in — same
  // predicate that drives the connection status line (see getConnectionTestState).
  const enforceable = getConnectionTestState(provider).kind === 'verified'

  const refresh = () => queryClient.invalidateQueries({ queryKey: IDENTITY_PROVIDERS_KEY })

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!provider || !draftName.trim()) return
    setAddError('')
    setAdding(true)
    try {
      await addDomain({ data: { providerId: provider.id, name: draftName.trim() } })
      await refresh()
      setDraftName('')
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not add domain.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border/40 pt-5">
      <div>
        <Label className="font-medium">Domains</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasVerified
            ? 'Users at a verified domain are routed here by default.'
            : 'Optional. With no domains this shows as a public "Sign in with…" button.'}
        </p>
      </div>

      {!provider ? (
        <p className="rounded-md border border-dashed border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
          Save the provider first to add a domain to route or enforce by email.
        </p>
      ) : (
        <>
          {domains.length === 0 ? (
            <p className="text-xs text-muted-foreground">No domains attached.</p>
          ) : (
            <div className="divide-y divide-border/50 rounded-md border border-border/50">
              {domains.map((d) => (
                <DomainRow
                  key={d.id}
                  domain={d}
                  disabled={disabled}
                  enforceable={enforceable}
                  onChanged={refresh}
                />
              ))}
            </div>
          )}

          {hasVerified && enforceable && (
            <WarningBox
              variant="warning"
              title="Before you enforce"
              description="Run a successful test sign-in and generate recovery codes first. They're your break-glass if SSO ever breaks."
            />
          )}

          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="acme.com"
                disabled={adding || disabled}
                className="h-9"
                aria-label="Add domain"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                className="h-9"
                disabled={adding || disabled || !draftName.trim()}
              >
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                {adding ? 'Adding…' : 'Add domain'}
              </Button>
            </div>
            {addError && (
              <Alert variant="destructive">
                <AlertDescription className="text-xs">{addError}</AlertDescription>
              </Alert>
            )}
          </form>
        </>
      )}
    </div>
  )
}

function DomainRow({
  domain,
  disabled,
  enforceable,
  onChanged,
}: {
  domain: VerifiedDomain
  disabled: boolean
  /** True when the provider has a fresh test sign-in — the enforcement
   *  checkbox is enabled. False disables the checkbox to prevent setting
   *  enforcement on an unverified connection. */
  enforceable: boolean
  onChanged: () => Promise<unknown> | void
}) {
  const verify = useServerFn(verifyProviderDomainFn)
  const setEnforced = useServerFn(setDomainEnforcedFn)
  const remove = useServerFn(removeVerifiedDomainFn)

  const [pending, setPending] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyDomainResult | null>(null)
  const [enforceError, setEnforceError] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const isVerified = domain.verifiedAt !== null
  const providerId = domain.providerId

  const handleRemove = async () => {
    setPending(true)
    try {
      await remove({ data: { id: domain.id } })
      await onChanged()
    } catch (err) {
      setEnforceError(err instanceof Error ? err.message : 'Could not remove domain.')
    } finally {
      setPending(false)
      setRemoveOpen(false)
    }
  }

  const handleVerify = async () => {
    if (!providerId) return
    setVerifyResult(null)
    setPending(true)
    try {
      const r = await verify({ data: { providerId, id: domain.id } })
      setVerifyResult(r)
      if (r.verified) await onChanged()
    } catch {
      setVerifyResult({ verified: false, reason: 'lookup-failed' })
    } finally {
      setPending(false)
    }
  }

  const handleEnforce = async (next: boolean) => {
    setEnforceError(null)
    setPending(true)
    try {
      await setEnforced({ data: { id: domain.id, enforced: next } })
      await onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setEnforceError(
        msg === 'recovery_codes_required'
          ? 'Generate recovery codes before enforcing SSO. They are the only break-glass way back in.'
          : msg || 'Could not update enforcement.'
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isVerified ? (
            <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <ClockIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          <span className="truncate text-sm font-medium">{domain.name}</span>
          <span className="text-xs text-muted-foreground">
            {isVerified ? (
              <>
                verified <TimeAgo date={domain.verifiedAt!} />
              </>
            ) : (
              'DNS pending'
            )}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isVerified && (
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={domain.enforced}
                onCheckedChange={(v) => void handleEnforce(v === true)}
                disabled={pending || disabled || !enforceable}
                aria-label={`Require SSO for ${domain.name}`}
              />
              Enforce SSO
            </label>
          )}
          {!isVerified && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={handleVerify}
              disabled={pending || disabled}
            >
              {pending ? 'Verifying…' : 'Verify'}
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setRemoveOpen(true)}
            disabled={pending || disabled}
            aria-label={`Remove ${domain.name}`}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isVerified && (
        <div className="space-y-1 rounded bg-muted/30 p-2 text-xs text-muted-foreground">
          <p>Add this DNS TXT record, then click Verify:</p>
          <code className="block break-all">
            _quackback-verify.{domain.name} = qb-domain-verify={domain.verificationToken}
          </code>
        </div>
      )}

      {verifyResult && !verifyResult.verified && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            {VERIFY_REASON_MESSAGES[verifyResult.reason]}
          </AlertDescription>
        </Alert>
      )}
      {enforceError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{enforceError}</AlertDescription>
        </Alert>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${isVerified ? 'verified' : 'pending'} domain?`}
        description={
          isVerified
            ? `Stops routing *@${domain.name} emails to this provider.`
            : `Discards the pending verification token for ${domain.name}.`
        }
        variant="destructive"
        confirmLabel="Remove"
        isPending={pending}
        onConfirm={handleRemove}
      />
    </div>
  )
}

/**
 * Claim-to-role mapping: an optional override on top of the provider's Default
 * role. With no rules everyone gets the default. The Claim path and each rule
 * value are creatable autocompletes sourced from the last matching test sign-in
 * (free text still allowed). Opens when `mapping !== null` or when a matching
 * test produced suggestions. The parent's handleSave persists null unless the
 * mapping carries rules or sync.
 */
function ClaimMappingEditor({
  mapping,
  disabled,
  registrationId,
  canTest,
  onChange,
}: {
  mapping: Mapping | null
  disabled: boolean
  registrationId: string
  /** True once the provider is saved, so a test sign-in can actually run. */
  canTest: boolean
  onChange: (mapping: Mapping | null) => void
}) {
  const ruleCount = mapping?.rules.length ?? 0
  const hasConfig = mapping !== null
  const current: Mapping = mapping ?? { claimPath: 'groups', rules: [] }
  const update = (patch: Partial<Mapping>) => onChange({ ...current, ...patch })

  const { lastSuccess } = useSsoTestSignIn()
  const suggestions =
    lastSuccess && lastSuccess.registrationId === registrationId
      ? deriveClaimSuggestions(lastSuccess.allClaims)
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
            gets the default role above.
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
