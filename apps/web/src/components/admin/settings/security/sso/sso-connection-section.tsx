import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowPathIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CopyButton } from '@/components/shared/copy-button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  OktaIcon,
  Auth0Icon,
  KeycloakIcon,
  MicrosoftEntraIcon,
  GoogleWorkspaceIcon,
  GenericOidcIcon,
  IDP_KIND_ICONS,
} from '@/components/icons/idp-provider-icons'
import { getIdpShortcut, inferIdpKind, type IdpKind } from '../idp-shortcuts'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import { setSsoClientSecretFn, switchSsoProviderFn } from '@/lib/server/functions/sso'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { useRouteContext } from '@tanstack/react-router'
import type { AuthConfig } from '@/lib/shared/types/settings'
import type { SsoStatus } from '@/lib/server/functions/sso'
import { TestSignInButton } from './test-sign-in-button'
import { useSsoTestSignIn } from './use-sso-test-sign-in'

interface SsoConnectionSectionProps {
  initialConfig: AuthConfig
  customOidcProviderTier: boolean
  ssoStatus: SsoStatus
}

/** Fixed-length mask for the client-secret field when a secret is
 *  saved. Industry-standard (Stripe, Vercel, AWS, Clerk) uses a fixed
 *  mask rather than the actual length — same "saved" affordance with
 *  no plaintext-length side-channel and no extra decrypt per render. */
const SAVED_SECRET_MASK = '•'.repeat(12)

/** Human labels for the ssoOidc field paths a server-fn validation
 *  error can reference. Keeps the save toast readable instead of
 *  dumping raw Zod issue JSON at the admin. */
const SSO_FIELD_LABELS: Record<string, string> = {
  'ssoOidc.discoveryUrl': 'Discovery URL',
  'ssoOidc.clientId': 'Client ID',
  'ssoOidc.autoProvisionRole': 'Default role',
  'ssoOidc.autoCreateUsers': 'Auto-create accounts',
}

interface ZodIssueLike {
  path?: (string | number)[]
  message?: string
  code?: string
}

/**
 * Best-effort: turn a server-fn validation rejection (whose `.message`
 * is a stringified Zod issue array) into one human sentence. Falls back
 * to the raw message when the shape isn't a Zod issue array — so a
 * plain server error (e.g. "Save the SSO client secret before
 * enabling SSO sign-in.") still passes through verbatim.
 */
function friendlySaveError(err: unknown): string {
  const raw = err instanceof Error ? err.message : ''
  if (!raw) return 'Could not save settings.'
  let issues: ZodIssueLike[]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return raw
    issues = parsed as ZodIssueLike[]
  } catch {
    return raw
  }
  if (issues.length === 0) return raw
  const parts = issues.map((iss) => {
    const pathKey = (iss.path ?? []).join('.')
    const label = SSO_FIELD_LABELS[pathKey] ?? pathKey ?? 'A field'
    if (iss.code === 'invalid_format') return `${label} must be a valid https:// URL`
    if (iss.code === 'too_small') return `${label} is required`
    return `${label}: ${iss.message ?? 'is invalid'}`
  })
  return parts.length === 1 ? parts[0] : `Fix the following before saving — ${parts.join('; ')}`
}

export function SsoConnectionSection({
  initialConfig,
  customOidcProviderTier,
  ssoStatus,
}: SsoConnectionSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const [authConfig, setAuthConfig] = useState<AuthConfig>(initialConfig)

  // Sync from the route's loader state when it refetches (e.g. after a
  // domain mutation invalidates the React Query cache). Without this the
  // parent label / SsoProviderHeader / tier flags lock to first-render
  // values. User edits live in the SsoConfiguredForm's local `draft`
  // and aren't disturbed by this re-sync.
  useEffect(() => {
    setAuthConfig(initialConfig)
  }, [initialConfig])
  // The IdP kind drives which shortcut input the configured form
  // shows above the discovery URL. Empty-state tile clicks set it
  // explicitly; otherwise we infer from the saved discovery URL so
  // a returning admin sees the matching shortcut pre-filled.
  const [selectedIdpKind, setSelectedIdpKind] = useState<IdpKind | null>(null)
  const [switchProviderOpen, setSwitchProviderOpen] = useState(false)
  const [switchProviderPending, setSwitchProviderPending] = useState(false)
  const [switchProviderError, setSwitchProviderError] = useState<string | null>(null)
  const inferredKind = useMemo(
    () => inferIdpKind(authConfig.ssoOidc?.discoveryUrl),
    [authConfig.ssoOidc?.discoveryUrl]
  )
  const effectiveIdpKind: IdpKind = selectedIdpKind ?? inferredKind

  const { managedFieldPaths = [] } =
    (useRouteContext({ from: '__root__' }) as { managedFieldPaths?: string[] }) ?? {}
  const isManaged = (path: string) => isPathManagedFromBootstrap(path, managedFieldPaths)

  const ssoConfig = authConfig.ssoOidc

  const save = async (input: Parameters<typeof updateAuthConfigFn>[0]['data']) => {
    setSaving(true)
    try {
      const updated = await updateAuthConfigFn({ data: input })
      setAuthConfig(updated)
      // Invalidate the React Query cache so suspense consumers (e.g.
      // <VerifiedDomainsSection>'s verified-but-disabled alert) re-render
      // with the saved state immediately, not after the 5-minute
      // stale-time. router.invalidate() alone does NOT refetch
      // suspense queries.
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ssoStatus'] })
      startTransition(() => {
        router.invalidate()
      })
      toast.success('Authentication settings saved.')
    } catch (err) {
      toast.error(friendlySaveError(err))
      throw err
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Single sign-on"
        description="Connect your company's identity provider (Okta, Auth0, Microsoft Entra, Google Workspace, Keycloak, or any OpenID Connect IdP)."
      >
        {!customOidcProviderTier ? (
          <SsoEnterpriseUpgradeCard />
        ) : !ssoConfig ? (
          // Mode B: ssoOidc isn't configured at all yet. Tile click
          // synthesizes a draft config (enabled stays false until the
          // admin saves) and the component switches to Mode C below.
          <SsoEmptyState
            onConfigure={(selection) => {
              // Google Workspace has a fixed discovery URL — pre-fill.
              // Other kinds start blank and the kind-aware shortcut
              // input populates as the admin types.
              const initialDiscovery =
                selection.kind === 'google'
                  ? 'https://accounts.google.com/.well-known/openid-configuration'
                  : ''
              setAuthConfig((prev: AuthConfig) => ({
                ...prev,
                ssoOidc: {
                  enabled: false,
                  discoveryUrl: initialDiscovery,
                  clientId: '',
                  autoCreateUsers: true,
                },
              }))
              setSelectedIdpKind(selection.kind)
            }}
          />
        ) : (
          <SsoConfiguredForm
            config={ssoConfig}
            idpKind={effectiveIdpKind}
            ssoStatus={ssoStatus}
            isManaged={isManaged}
            saving={saving || isPending}
            onSave={async (next) => save({ ssoOidc: next })}
            onSwitchProvider={async () => {
              setSwitchProviderOpen(true)
            }}
            onSecretChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'ssoStatus'] })
              void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
              startTransition(() => router.invalidate())
            }}
          />
        )}
      </SettingsCard>

      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving…</span>
        </div>
      )}

      <ConfirmDialog
        open={switchProviderOpen}
        onOpenChange={(next) => {
          // Block close while the destructive call is in flight —
          // closing here would leave the secret partly cleared and the
          // UI partly advanced.
          if (switchProviderPending) return
          if (!next) setSwitchProviderError(null)
          setSwitchProviderOpen(next)
        }}
        title="Change identity provider?"
        description={
          switchProviderError ??
          'The saved client secret will be removed and SSO sign-in will stop working until you finish setup for the new provider.'
        }
        variant="destructive"
        confirmLabel="Change provider"
        isPending={switchProviderPending}
        onConfirm={async () => {
          setSwitchProviderPending(true)
          setSwitchProviderError(null)
          let result: { success: boolean; defangedDomains: string[] }
          try {
            // switchSsoProviderFn clears the encrypted secret, the
            // authConfig.ssoOidc block, and any per-domain `enforced`
            // flags in one transaction. The route's authConfig query
            // refetches "no SSO configured" payload and the form snaps
            // back to the provider picker.
            result = await switchSsoProviderFn({})
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Could not switch identity provider.'
            setSwitchProviderError(message)
            setSwitchProviderPending(false)
            // Toast in addition to the inline dialog error — radix
            // AlertDialogAction auto-closes the dialog on click, so the
            // inline message may not be visible if the close lands first.
            toast.error(message)
            return
          }
          if (result.defangedDomains.length > 0) {
            toast.success(
              result.defangedDomains.length === 1
                ? `Disabled SSO enforcement on ${result.defangedDomains[0]} — re-enable after configuring the new provider.`
                : `Disabled SSO enforcement on ${result.defangedDomains.length} domains — re-enable after configuring the new provider.`
            )
          } else {
            toast.success('Identity provider cleared. Pick a new provider to continue.')
          }
          // Local optimistic clear so the empty-state picker renders
          // immediately. The route-loader refetch (via
          // queryClient.invalidateQueries) reconciles to the same shape,
          // so the resync useEffect doesn't bounce the UI back.
          startTransition(() => {
            setAuthConfig((prev: AuthConfig) => ({ ...prev, ssoOidc: undefined }))
            setSelectedIdpKind(null)
            setSwitchProviderPending(false)
            setSwitchProviderOpen(false)
          })
          void queryClient.invalidateQueries({ queryKey: ['admin', 'ssoStatus'] })
          void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
          void queryClient.invalidateQueries({ queryKey: ['settings', 'verifiedDomains'] })
          router.invalidate()
        }}
      />
    </div>
  )
}

function SsoEnterpriseUpgradeCard() {
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-muted/10 p-6 text-center">
      <Badge className="mb-3 bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/15">
        Enterprise
      </Badge>
      <h3 className="text-base font-semibold">Single sign-on is an Enterprise feature</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        Let your team sign in through Okta, Auth0, Keycloak, Microsoft Entra, Google Workspace, or
        any OpenID Connect provider.
      </p>
      <Button asChild variant="default" className="mt-4">
        <a href="https://www.quackback.io/pricing" target="_blank" rel="noopener noreferrer">
          Upgrade plan
          <ArrowTopRightOnSquareIcon className="ml-1.5 h-3.5 w-3.5" />
        </a>
      </Button>
    </div>
  )
}

/** Friendly display name per IdP kind. Used both by the empty-state
 *  tiles and by SsoProviderHeader so a configured workspace shows
 *  "Microsoft Entra" instead of the generic "Single sign-on". */
const IDP_KIND_NAMES: Record<IdpKind, string> = {
  okta: 'Okta',
  auth0: 'Auth0',
  keycloak: 'Keycloak',
  entra: 'Microsoft Entra',
  google: 'Google Workspace',
  other: 'Custom OIDC',
}

// Tiles dispatch on `kind`. Per-kind shortcut inputs (Okta domain,
// Entra tenant, etc.) are defined in idp-shortcuts.ts.
const SSO_EMPTY_STATE_TILES: Array<{
  name: string
  kind: IdpKind
  icon: typeof OktaIcon
  iconBg: string
  iconFg: string
}> = [
  {
    name: IDP_KIND_NAMES.okta,
    kind: 'okta',
    icon: OktaIcon,
    iconBg: 'bg-blue-500/15',
    iconFg: 'text-blue-600',
  },
  {
    name: IDP_KIND_NAMES.auth0,
    kind: 'auth0',
    icon: Auth0Icon,
    iconBg: 'bg-orange-500/15',
    iconFg: 'text-orange-600',
  },
  {
    name: IDP_KIND_NAMES.keycloak,
    kind: 'keycloak',
    icon: KeycloakIcon,
    iconBg: 'bg-cyan-500/15',
    iconFg: 'text-cyan-600',
  },
  // Multicolour Microsoft mark — neutral background so the four brand squares stay legible.
  {
    name: IDP_KIND_NAMES.entra,
    kind: 'entra',
    icon: MicrosoftEntraIcon,
    iconBg: 'bg-muted',
    iconFg: '',
  },
  {
    name: IDP_KIND_NAMES.google,
    kind: 'google',
    icon: GoogleWorkspaceIcon,
    iconBg: 'bg-muted',
    iconFg: '',
  },
  {
    name: 'Other OIDC',
    kind: 'other',
    icon: GenericOidcIcon,
    iconBg: 'bg-muted',
    iconFg: 'text-muted-foreground',
  },
]

function SsoEmptyState({
  onConfigure,
}: {
  onConfigure: (selection: { name: string; kind: IdpKind }) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Choose your identity provider</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          We&rsquo;ll pre-fill the discovery URL for known IdPs. Pick &ldquo;Other OIDC&rdquo; for
          anything else. You can switch any time before saving.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SSO_EMPTY_STATE_TILES.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onConfigure({ name: t.name, kind: t.kind })}
              className="group flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-muted/30"
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${t.iconBg}`}
              >
                <Icon className={`h-4 w-4 ${t.iconFg}`} />
              </div>
              <span className="flex-1 text-sm font-medium">{t.name}</span>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SsoConfiguredForm({
  config,
  idpKind,
  ssoStatus,
  isManaged,
  saving,
  onSave,
  onSwitchProvider,
  onSecretChanged,
}: {
  config: NonNullable<AuthConfig['ssoOidc']>
  /** Drives which per-IdP shortcut input renders above the discovery
   *  URL (Okta domain, Entra tenant, Keycloak base+realm, etc.).
   *  Inferred from the discoveryUrl when admins return to a saved
   *  config; explicit when they pick a tile in the empty state. */
  idpKind: IdpKind
  ssoStatus: SsoStatus
  isManaged: (path: string) => boolean
  saving: boolean
  onSave: (next: Partial<NonNullable<AuthConfig['ssoOidc']>>) => Promise<void>
  /** Reset back to the empty-state provider picker. Non-destructive —
   *  the picker selection only updates the parent draft until Save. */
  onSwitchProvider: () => Promise<void>
  /** Refresh ssoStatus after the secret is saved or cleared. Parent
   *  re-runs the loader so secretConfigured/discoveryReachable flip. */
  onSecretChanged: () => void
}) {
  const [draft, setDraft] = useState(config)
  const [secretDraft, setSecretDraft] = useState('')
  // Tracks whether the admin has interacted with the secret field. While
  // false AND a saved secret exists, the input shows masked dots as its
  // *value* (not placeholder) so the field reads as filled-in. On focus
  // we flip touched=true and the field becomes a normal blank password
  // input — typing replaces the secret; leaving it blank preserves the
  // existing one (handleSave skips the call when secretDraft is empty).
  const [secretTouched, setSecretTouched] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)
  const [confirmAdminRoleOpen, setConfirmAdminRoleOpen] = useState(false)
  const [pendingRoleChange, setPendingRoleChange] = useState<'admin' | 'member' | 'user' | null>(
    null
  )
  const { open: openTestSignIn } = useSsoTestSignIn()

  const fieldManaged = (key: keyof NonNullable<AuthConfig['ssoOidc']>) =>
    isManaged(`auth.ssoOidc.${String(key)}`)

  const handleSave = async () => {
    setSecretError(null)
    // Save the typed secret first so authConfig updates ride on top of
    // a known-good credential row. If the secret write fails we bail
    // before touching authConfig — partial saves are confusing.
    if (secretDraft.trim()) {
      try {
        await setSsoClientSecretFn({ data: { clientSecret: secretDraft.trim() } })
        setSecretDraft('')
        setSecretTouched(false)
        onSecretChanged()
      } catch (err) {
        const msg = friendlySaveError(err)
        setSecretError(msg)
        toast.error(msg)
        return
      }
    }
    const payload: Partial<NonNullable<AuthConfig['ssoOidc']>> = {}
    const all: Array<keyof NonNullable<AuthConfig['ssoOidc']>> = [
      'enabled',
      'discoveryUrl',
      'clientId',
      'autoCreateUsers',
      'autoProvisionRole',
    ]
    for (const key of all) {
      if (fieldManaged(key)) continue
      ;(payload as Record<string, unknown>)[key] = draft[key]
    }
    await onSave(payload)
  }

  /** Toggle the master Enabled flag. Immediate-save (like Password
   *  and OAuth toggles elsewhere) — no Save click needed for a single
   *  boolean. Updates the local draft optimistically so the header
   *  reflects the change before the round-trip lands.
   *
   *  Turning ON is gated: enabling SSO needs a test sign-in that
   *  postdates the last connection-details change. When the server
   *  status says we're not eligible, the toggle opens the shared test
   *  sign-in modal instead of failing the save — an identity-matched
   *  success then auto-applies the enable. Turning OFF is never gated. */
  const handleEnabledToggle = async (next: boolean) => {
    if (next && !ssoStatus.enableEligible) {
      openTestSignIn({
        reason: 'Test sign-in required before enabling SSO.',
        successMessage: 'Single sign-on is now enabled.',
        onSuccess: async () => {
          setDraft((d) => ({ ...d, enabled: true }))
          await onSave({ enabled: true })
        },
      })
      return
    }
    setDraft({ ...draft, enabled: next })
    await onSave({ enabled: next })
  }

  return (
    <div className="space-y-6">
      <SsoProviderHeader
        config={draft}
        idpKind={idpKind}
        ssoStatus={ssoStatus}
        onSwitchProvider={onSwitchProvider}
        onEnabledChange={handleEnabledToggle}
        enabledManaged={fieldManaged('enabled')}
        saving={saving}
      />

      {/* Connection — credentials + actions. The master Enabled toggle
       *  lives in the header (immediate effect, paired with the status
       *  pill). Credentials need an explicit Save. */}
      <div className="space-y-4">
        <RedirectUriCallout uri={ssoStatus.redirectUri} />

        <IdpDiscoveryFields
          kind={idpKind}
          discoveryUrl={draft.discoveryUrl}
          managed={fieldManaged('discoveryUrl')}
          onChange={(url) => setDraft({ ...draft, discoveryUrl: url })}
        />
        <Field
          label="Client ID"
          managed={fieldManaged('clientId')}
          value={draft.clientId}
          onChange={(v) => setDraft({ ...draft, clientId: v })}
        />
        <Field
          label="Client secret"
          type="password"
          value={!secretTouched && ssoStatus.secretConfigured ? SAVED_SECRET_MASK : secretDraft}
          onChange={(v) => {
            setSecretTouched(true)
            setSecretDraft(v)
          }}
          onFocus={() => {
            if (!secretTouched && ssoStatus.secretConfigured) {
              setSecretTouched(true)
              setSecretDraft('')
            }
          }}
        />
        {secretError && (
          <Alert variant="destructive">
            <AlertDescription>{secretError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-start justify-between gap-4 py-2">
          <div className="flex-1 min-w-0">
            <Label className="font-medium">Auto-create accounts on first sign-in</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              New users from your IdP land in Quackback with the role you pick.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {draft.autoCreateUsers && (
              <Select
                value={draft.autoProvisionRole ?? 'member'}
                onValueChange={(role) => {
                  const next = role as 'admin' | 'member' | 'user'
                  if (next === 'admin' && draft.autoProvisionRole !== 'admin') {
                    setPendingRoleChange(next)
                    setConfirmAdminRoleOpen(true)
                    return
                  }
                  setDraft({ ...draft, autoProvisionRole: next })
                }}
                disabled={fieldManaged('autoProvisionRole') || saving}
              >
                <SelectTrigger className="h-9 w-[140px] text-xs" aria-label="Default role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="user">Portal user</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Switch
              checked={draft.autoCreateUsers}
              onCheckedChange={(v) => setDraft({ ...draft, autoCreateUsers: v })}
              disabled={fieldManaged('autoCreateUsers') || saving}
              aria-label="Auto-create accounts on first sign-in"
            />
          </div>
        </div>

        <ConfirmDialog
          open={confirmAdminRoleOpen}
          onOpenChange={(open) => {
            if (!open) setPendingRoleChange(null)
            setConfirmAdminRoleOpen(open)
          }}
          title="Auto-create new users as admin?"
          description="Anyone who signs in via SSO at a verified domain will land with full admin access. Make sure your IdP's user directory is curated."
          warning={{ title: 'High-blast-radius default.' }}
          variant="destructive"
          confirmLabel="Use admin as default"
          onConfirm={() => {
            if (pendingRoleChange) setDraft({ ...draft, autoProvisionRole: pendingRoleChange })
            setPendingRoleChange(null)
            setConfirmAdminRoleOpen(false)
          }}
        />

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <TestSignInButton disabled={saving || !ssoStatus.secretConfigured} />
        </div>
      </div>
    </div>
  )
}

/**
 * Header shown above the SSO config form. Identifies the chosen IdP at
 * a glance and (when the form is still a draft) lets the admin go back
 * to the provider picker without typing.
 */
function SsoProviderHeader({
  config,
  idpKind,
  ssoStatus,
  onSwitchProvider,
  onEnabledChange,
  enabledManaged,
  saving,
}: {
  config: NonNullable<AuthConfig['ssoOidc']>
  /** Structured IdP kind (already inferred from discoveryUrl); drives
   *  the brand icon. Avoids substring-matching the user-typed
   *  display name. */
  idpKind: IdpKind
  ssoStatus: SsoStatus
  onSwitchProvider: () => void
  /** Immediate-save handler for the master Enabled toggle. The toggle
   *  is rendered inline with the provider strip so it sits next to the
   *  Live / Needs setup status pill — admins flipping SSO on/off don't
   *  have to scroll past the credentials form. */
  onEnabledChange: (next: boolean) => void | Promise<void>
  enabledManaged: boolean
  saving: boolean
}) {
  // Brand icon keyed on the structured IdP kind. Falls back to the
  // generic OIDC mark for `'other'` / custom IdPs we don't ship for.
  const BrandIcon = IDP_KIND_ICONS[idpKind as keyof typeof IDP_KIND_ICONS] ?? GenericOidcIcon
  // Friendly provider name reads better than the generic "Single sign-on".
  // Falls back to "Single sign-on" for the `'other'` kind so the header
  // still reads cleanly for custom OIDC providers.
  const headerLabel = idpKind === 'other' ? 'Single sign-on' : IDP_KIND_NAMES[idpKind]
  // True only when the IdP is reachable AND the workspace has a saved
  // secret AND the admin has flipped Enabled on. Drives the green "Live"
  // pill. Distinct from `statusLabel.color` so the subtext can stay
  // muted while the pill remains the single source of liveness.
  const isLive =
    config.enabled && ssoStatus.secretConfigured && ssoStatus.discoveryReachable !== false
  // Status reflects the most-blocking condition first, then the most
  // useful "next action" hint — admins scan this line first.
  const statusLabel = (() => {
    if (!ssoStatus.secretConfigured) {
      return {
        color: 'text-destructive',
        node: 'Add a client secret to finish setup' as React.ReactNode,
      }
    }
    if (ssoStatus.discoveryReachable === false) {
      return {
        color: 'text-destructive',
        node: "Can't reach your IdP's discovery URL" as React.ReactNode,
      }
    }
    if (config.enabled) {
      return {
        color: 'text-muted-foreground',
        node: ssoStatus.lastSignInAt ? (
          <>
            Last sign-in <TimeAgo date={ssoStatus.lastSignInAt} />
          </>
        ) : (
          'Waiting for first sign-in'
        ),
      }
    }
    return { color: 'text-muted-foreground', node: 'Saved but disabled' as React.ReactNode }
  })()

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
          <BrandIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold truncate">{headerLabel}</p>
            {isLive && (
              <Badge
                variant="outline"
                className="border-green-500/30 text-green-600 text-[10px] px-1.5 py-0"
              >
                Live
              </Badge>
            )}
            {config.enabled && !isLive && (
              <Badge
                variant="outline"
                className="border-destructive/30 text-destructive text-[10px] px-1.5 py-0"
              >
                Needs setup
              </Badge>
            )}
          </div>
          <p className={`text-xs mt-0.5 ${statusLabel.color}`}>{statusLabel.node}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4 sm:shrink-0">
        <div className="flex items-center gap-2">
          <Label htmlFor="sso-enabled-toggle" className="text-xs text-muted-foreground">
            Enabled
          </Label>
          <Switch
            id="sso-enabled-toggle"
            checked={config.enabled}
            onCheckedChange={onEnabledChange}
            disabled={enabledManaged || saving}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onSwitchProvider} className="h-9 sm:h-8">
          Change provider
        </Button>
      </div>
    </div>
  )
}

/**
 * Visual grouping for related form fields. Adds a small section header
 * + indent so the configured form doesn't read as one long flat list.
 */
/**
 * Read-only display of the OAuth redirect URI the admin needs to
 * register in their IdP. Without this in the IdP's allowed-redirect
 * list, sign-in fails (Azure: AADSTS500113 "No reply address is
 * registered"; Okta: "Invalid redirect_uri"; Auth0: "Callback URL
 * mismatch"). Copy button + plain-text fallback.
 */
function RedirectUriCallout({ uri }: { uri: string }) {
  return (
    <div>
      <Label>Redirect URI to register in your IdP</Label>
      <div className="mt-1 flex items-center gap-2">
        <code className="flex-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono text-xs break-all">
          {uri}
        </code>
        <CopyButton value={uri} aria-label="Copy redirect URI" />
      </div>
    </div>
  )
}

/**
 * IdP-aware identity-discovery inputs. Renders one of:
 *  - per-kind shortcut fields (Okta domain / Auth0 domain / Entra
 *    tenant / Keycloak base+realm) when the kind has them — the
 *    canonical discovery URL is built from the inputs and threaded up
 *    via `onChange` so the rest of the save pipeline is unchanged.
 *  - the raw discovery URL input for `kind === 'other'` — admins on
 *    a custom OIDC provider paste the URL directly.
 *  - nothing for `kind === 'google'` — the discovery URL is fixed and
 *    pre-filled at selection time.
 *
 * Mirrors WorkOS / Stytch admin UIs: the form asks for the term the
 * admin already knows ("Okta domain"), not for the OIDC plumbing.
 */
function IdpDiscoveryFields({
  kind,
  discoveryUrl,
  managed,
  onChange,
}: {
  kind: IdpKind
  discoveryUrl: string
  managed: boolean
  onChange: (url: string) => void
}) {
  const def = getIdpShortcut(kind)

  if (kind === 'other') {
    return (
      <Field
        label="Discovery URL"
        managed={managed}
        value={discoveryUrl}
        onChange={onChange}
        placeholder="https://your-idp/.well-known/openid-configuration"
      />
    )
  }

  if (def.fields.length === 0) {
    return def.docUrl ? <IdpSetupGuideLink href={def.docUrl} /> : null
  }

  return (
    <>
      <IdpShortcutInputs
        def={def}
        discoveryUrl={discoveryUrl}
        managed={managed}
        onChange={onChange}
      />
      {def.docUrl && <IdpSetupGuideLink href={def.docUrl} />}
    </>
  )
}

function IdpSetupGuideLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      View provider setup guide
      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
    </a>
  )
}

function IdpShortcutInputs({
  def,
  discoveryUrl,
  managed,
  onChange,
}: {
  def: ReturnType<typeof getIdpShortcut>
  discoveryUrl: string
  managed: boolean
  onChange: (url: string) => void
}) {
  // In-progress un-parseable text the admin is typing. Once `def.build`
  // returns a URL, that flows up and `def.parse(discoveryUrl)` reflects
  // it back; the local draft is dropped. Until then, keep the partial
  // input alive so keystrokes aren't clobbered by re-parsing an empty
  // canonical URL.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const parsed = def.parse(discoveryUrl)
  const values = parsed ?? draft

  const apply = (next: Record<string, string>) => {
    setDraft(next)
    const url = def.build(next)
    if (url) onChange(url)
  }

  return (
    <>
      {def.fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          value={values[f.key] ?? ''}
          onChange={(v) => apply({ ...values, [f.key]: v })}
          managed={managed}
          placeholder={f.placeholder}
          help={f.help}
        />
      ))}
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  managed,
  placeholder,
  help,
  type,
  action,
  onFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  managed?: boolean
  placeholder?: string
  help?: string
  type?: 'text' | 'password'
  /** Right-aligned slot in the label row (e.g. a Remove link). */
  action?: React.ReactNode
  onFocus?: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>{label}</Label>
        {action ??
          (managed && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Managed
            </Badge>
          ))}
      </div>
      <Input
        type={type ?? 'text'}
        autoComplete={type === 'password' ? 'off' : undefined}
        spellCheck={type === 'password' ? false : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        disabled={managed}
        placeholder={placeholder}
      />
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}
