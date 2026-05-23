import { useState, useTransition, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import {
  ArrowPathIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  KeyIcon,
  ShieldCheckIcon,
  LockClosedIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { OAuthProviderGrid } from '@/components/admin/settings/auth-shared/oauth-provider-grid'
import { AuthProviderCredentialsDialog } from '@/components/admin/settings/portal-auth/auth-provider-credentials-dialog'
import { PortalPrivacyDialog } from '@/components/admin/settings/portal-privacy-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WarningBox } from '@/components/shared/warning-box'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { updatePortalAccessFn } from '@/lib/server/functions/portal-access'
import {
  sendPortalInviteFn,
  cancelPortalInviteFn,
  resendPortalInviteFn,
  fetchPortalInvitesFn,
} from '@/lib/server/functions/portal-invites'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { useRouteContext } from '@tanstack/react-router'
import { cn } from '@/lib/shared/utils'
import type { PortalAuthMethods, PortalConfig } from '@/lib/shared/types/settings'

interface PortalAuthTabProps {
  initialOauth: PortalAuthMethods
  credentialStatus: Record<string, boolean> & { _emailConfigured?: boolean }
  customOidcProviderTier: boolean
  portalConfig: PortalConfig
}

/**
 * Portal sign-in tab inside the unified Authentication page.
 *
 * Mirrors the previous standalone /admin/settings/portal-auth page but
 * inlined here so admins don't have to navigate to two separate places
 * to compare team vs portal config. Uses the same `<OAuthProviderGrid>`
 * the Team tab does — clicking "Configure" on any provider opens the
 * shared `AuthProviderCredentialsDialog` (one row in
 * `platform_credentials` powers both surfaces).
 *
 * Differences from the Team tab:
 *  - No SSO card (SSO is admin-only by design — IdPs typically issue
 *    one client secret per Quackback deployment, scoped to team admins
 *    rather than end users).
 *  - Magic Link defaults to off; password defaults to on.
 *  - No enforcement / bootstrap guard — portal is opt-in self-service.
 *
 * The `Sign-in Methods` card includes an explicit info row pointing
 * users to the Team tab for SSO so the absence isn't silent.
 */
// ---------------------------------------------------------------------------
// Visibility option descriptors
// ---------------------------------------------------------------------------

interface VisibilityOption {
  value: 'public' | 'private'
  label: string
  description: string
  icon: typeof LockClosedIcon
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your portal without signing in.',
    icon: GlobeAltIcon,
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Visitors must be authorized to view the portal.',
    icon: LockClosedIcon,
  },
]

export function PortalAuthTab({
  initialOauth,
  credentialStatus,
  customOidcProviderTier,
  portalConfig,
}: PortalAuthTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [oauthState, setOauthState] = useState<Record<string, boolean | undefined>>(initialOauth)

  // --- Portal visibility + allowed-domains: shared busy lock ---
  //
  // A single `accessBusy` flag covers both visibility and domain saves so
  // the two fields can never race. Refs hold the current logical values so
  // that every call to `applyAccess` reads fresh state regardless of when
  // the closure was created — no stale capture is possible.

  const currentVisibility = (portalConfig.access?.visibility ?? 'public') as 'public' | 'private'
  const [visibility, setVisibility] = useState<'public' | 'private'>(currentVisibility)
  const visibilityRef = useRef(visibility)
  visibilityRef.current = visibility

  const [allowedDomains, setAllowedDomains] = useState<string[]>(
    portalConfig.access?.allowedDomains ?? []
  )
  const allowedDomainsRef = useRef(allowedDomains)
  allowedDomainsRef.current = allowedDomains

  const [widgetSignIn, setWidgetSignIn] = useState<boolean>(
    portalConfig.access?.widgetSignIn ?? false
  )
  const widgetSignInRef = useRef(widgetSignIn)
  widgetSignInRef.current = widgetSignIn

  const [accessBusy, setAccessBusy] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [pendingVisibility, setPendingVisibility] = useState<'public' | 'private' | null>(null)
  const [domainInput, setDomainInput] = useState('')
  const [domainInputError, setDomainInputError] = useState<string | null>(null)

  const isAccessBusy = accessBusy || isPending

  /**
   * Single save path for visibility, domain, and widget sign-in changes.
   *
   * The changed field is supplied explicitly by the caller; all peer fields
   * are read from their refs so stale-closure captures are impossible. This
   * ensures:
   *  - No two saves overlap (`accessBusy` gates all three controls).
   *  - No field persists a stale value: the caller owns its field, refs own
   *    the peers.
   */
  async function applyAccess(
    nextVisibility: 'public' | 'private',
    nextDomains: string[],
    nextWidgetSignIn?: boolean
  ) {
    const prevVisibility = visibilityRef.current
    const prevDomains = allowedDomainsRef.current
    const prevWidgetSignIn = widgetSignInRef.current
    const resolvedWidgetSignIn = nextWidgetSignIn ?? prevWidgetSignIn

    // Optimistic update
    setVisibility(nextVisibility)
    setAllowedDomains(nextDomains)
    setWidgetSignIn(resolvedWidgetSignIn)
    setAccessBusy(true)

    try {
      await updatePortalAccessFn({
        data: {
          visibility: nextVisibility,
          allowedDomains: nextDomains,
          widgetSignIn: resolvedWidgetSignIn,
        },
      })
      startTransition(() => {
        router.invalidate()
      })
    } catch {
      // Revert all fields on error
      setVisibility(prevVisibility)
      setAllowedDomains(prevDomains)
      setWidgetSignIn(prevWidgetSignIn)
    } finally {
      setAccessBusy(false)
    }
  }

  function handleVisibilitySelect(next: 'public' | 'private') {
    if (next === visibilityRef.current || isAccessBusy) return

    if (next === 'private') {
      setPendingVisibility('private')
      setDialogOpen(true)
    } else {
      // Changing to public: keep current domains (ref) alongside new visibility
      void applyAccess('public', allowedDomainsRef.current)
    }
  }

  function handleConfirmPrivate() {
    setDialogOpen(false)
    if (pendingVisibility === 'private') {
      setPendingVisibility(null)
      // Changing to private: keep current domains (ref) alongside new visibility
      void applyAccess('private', allowedDomainsRef.current)
    }
  }

  function handleCancelDialog(open: boolean) {
    if (!open) {
      setPendingVisibility(null)
    }
    setDialogOpen(open)
  }

  function handleAddDomain() {
    const raw = domainInput.trim().toLowerCase().replace(/^@/, '')
    if (!raw) return

    // Basic client-side validation matching server normalization rules
    if (raw.includes('://') || raw.includes('@') || /\s/.test(raw) || !raw.includes('.')) {
      setDomainInputError('Enter a valid domain, e.g. acme.com')
      return
    }

    if (allowedDomainsRef.current.includes(raw)) {
      setDomainInputError('Domain already in the list')
      return
    }

    setDomainInputError(null)
    setDomainInput('')
    // Keep current visibility (ref); update domains
    void applyAccess(visibilityRef.current, [...allowedDomainsRef.current, raw])
  }

  function handleRemoveDomain(domain: string) {
    // Keep current visibility (ref); update domains
    void applyAccess(
      visibilityRef.current,
      allowedDomainsRef.current.filter((d) => d !== domain)
    )
  }

  function handleDomainKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddDomain()
    }
  }

  const { managedFieldPaths = [] } =
    (useRouteContext({ from: '__root__' }) as { managedFieldPaths?: string[] }) ?? {}
  const isManaged = (path: string) => isPathManagedFromBootstrap(path, managedFieldPaths)

  const emailConfigured = credentialStatus._emailConfigured !== false
  const passwordEnabled = oauthState.password ?? true
  const magicLinkEnabled = oauthState.magicLink ?? false

  // Last-enabled-method guard. Portal has no locked-on method, so we
  // refuse to disable the only remaining one. Legacy `email` flag is
  // excluded — migration 0049 retired it in favour of magicLink.
  const enabledMethodCount = Object.entries(oauthState).filter(
    ([k, v]) => v && k !== 'email'
  ).length
  const isLastMethod = (id: string) => !!oauthState[id] && enabledMethodCount === 1

  // Gates on what's *usable* (intent flag AND credentials), not on raw
  // intent — a `google: true` flag with no saved credential renders as
  // a "Not configured" tile and isn't a working sign-in surface.
  const noPortalAuthEnabled = (() => {
    if (oauthState.password) return false
    if (oauthState.magicLink && emailConfigured) return false
    return !Object.entries(oauthState).some(([id, enabled]) => {
      if (!enabled) return false
      if (id === 'password' || id === 'magicLink' || id === 'email') return false
      return !!credentialStatus[id]
    })
  })()

  const save = async (patch: Record<string, boolean | undefined>) => {
    setSaving(true)
    try {
      await updatePortalConfigFn({ data: { oauth: patch } })
      startTransition(() => router.invalidate())
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = (id: string, checked: boolean) => {
    setOauthState((prev) => ({ ...prev, [id]: checked }))
    void save({ [id]: checked })
  }

  const [configDialog, setConfigDialog] = useState<{
    credentialType: string
    providerId: string
    providerName: string
    helpUrl?: string
    fields: (typeof AUTH_PROVIDERS)[number]['platformCredentials']
  } | null>(null)

  const openConfigDialog = (provider: (typeof AUTH_PROVIDERS)[number]) => {
    const helpUrl = provider.platformCredentials.find((f) => f.helpUrl)?.helpUrl
    setConfigDialog({
      credentialType: provider.credentialType,
      providerId: provider.id,
      providerName: provider.name,
      helpUrl,
      fields: provider.platformCredentials,
    })
  }

  return (
    <div className="space-y-6">
      {/* Portal visibility — radio + (when private) allowed-domains editor */}
      <SettingsCard
        title="Portal visibility"
        description="Choose whether your portal is open to anyone or restricted to authorized visitors."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VISIBILITY_OPTIONS.map((option) => {
            const isSelected = visibility === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleVisibilitySelect(option.value)}
                disabled={isAccessBusy}
                className={cn(
                  'relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border/50 bg-card hover:border-border hover:bg-muted/30',
                  isAccessBusy && 'cursor-not-allowed opacity-60'
                )}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isSelected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <span className="text-sm font-medium">{option.label}</span>
                  {accessBusy && isSelected && (
                    <ArrowPathIcon className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </button>
            )
          })}
        </div>

        {/* Allowed email domains — only meaningful when the portal is private */}
        {visibility === 'private' && (
          <div className="mt-6 border-t border-border/50 pt-6 space-y-4">
            <div>
              <p className="text-sm font-medium">Allowed email domains</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Signed-in users with a verified email on these domains can access the private
                portal.
              </p>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={domainInput}
                  onChange={(e) => {
                    setDomainInput(e.target.value)
                    if (domainInputError) setDomainInputError(null)
                  }}
                  onKeyDown={handleDomainKeyDown}
                  placeholder="acme.com"
                  disabled={isAccessBusy}
                  aria-label="Add email domain"
                  aria-invalid={!!domainInputError}
                  className={cn(domainInputError && 'border-destructive')}
                />
                {domainInputError && (
                  <p className="mt-1 text-xs text-destructive">{domainInputError}</p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddDomain}
                disabled={!domainInput.trim() || isAccessBusy}
                className="h-9 shrink-0"
              >
                <PlusIcon className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
              {accessBusy && (
                <div className="flex items-center">
                  <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            {allowedDomains.length > 0 ? (
              <ul className="space-y-1.5" role="list" aria-label="Allowed domains">
                {allowedDomains.map((domain) => (
                  <li
                    key={domain}
                    className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-1.5"
                  >
                    <span className="text-sm font-mono">{domain}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveDomain(domain)}
                      disabled={isAccessBusy}
                      className="ml-2 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 transition-colors"
                      aria-label={`Remove ${domain}`}
                    >
                      <XMarkIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No domains added yet. Anyone signed in must be a team member to access the portal.
              </p>
            )}

            {/* Email invites — below domains, same private-only block */}
            <PortalInvitesSection />

            {/* Widget sign-in — below invites, same private-only block */}
            <div className="mt-6 border-t border-border/50 pt-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Widget sign-in</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Allow users authenticated through the widget (in verified-identity mode) to
                    access this portal. They&apos;ll see a &ldquo;Go to portal&rdquo; link in the
                    widget.
                  </p>
                </div>
                <Switch
                  id="widget-signin-toggle"
                  checked={widgetSignIn}
                  onCheckedChange={(checked) => {
                    void applyAccess(visibilityRef.current, allowedDomainsRef.current, checked)
                  }}
                  disabled={isAccessBusy}
                  aria-label="Allow widget-authenticated users to access the portal"
                />
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      <PortalPrivacyDialog
        open={dialogOpen}
        onOpenChange={handleCancelDialog}
        onConfirm={handleConfirmPrivate}
      />

      {noPortalAuthEnabled && (
        <WarningBox
          variant="warning"
          title="No portal sign-in enabled"
          description={
            <>
              Visitors can&apos;t sign in or sign up on your portal. Your team can still sign in at{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">/admin</code>.
            </>
          }
        />
      )}

      {/* Card — Sign-in Methods */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="px-6 py-4 border-b border-border/50">
          <h2 className="text-base font-semibold">Sign-in methods</h2>
          <p className="text-xs text-muted-foreground mt-1">
            How visitors sign in to your public feedback portal.
          </p>
        </div>
        <div className="p-6 space-y-4">
          <MethodRow
            icon={KeyIcon}
            label="Password"
            description="Sign in with email and password."
            checked={passwordEnabled}
            onCheckedChange={(v) => handleToggle('password', v)}
            disabled={
              saving ||
              isPending ||
              isManaged('portalConfig.oauth.password') ||
              (passwordEnabled && enabledMethodCount === 1)
            }
            badge={isManaged('portalConfig.oauth.password') ? 'Managed' : undefined}
            badgeTooltip={
              isManaged('portalConfig.oauth.password')
                ? 'Managed by your configuration file.'
                : undefined
            }
          />
          <MethodRow
            icon={EnvelopeIcon}
            label="Email magic link"
            description={
              emailConfigured
                ? 'One-click link or 6-digit code by email.'
                : 'Configure SMTP or Resend to enable email delivery.'
            }
            checked={magicLinkEnabled}
            onCheckedChange={(v) => handleToggle('magicLink', v)}
            disabled={
              saving ||
              isPending ||
              !emailConfigured ||
              isManaged('portalConfig.oauth.magicLink') ||
              (magicLinkEnabled && enabledMethodCount === 1)
            }
          />
        </div>
      </div>

      {/* Card — OAuth Providers (portal-side toggles) */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="px-6 py-4 border-b border-border/50">
          <h2 className="text-base font-semibold">Social sign-in</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Let visitors sign in with Google, GitHub, and more. Configure each provider once and
            enable it for the Team or Portal.
          </p>
        </div>
        <div className="p-6">
          <OAuthProviderGrid
            enabled={oauthState}
            credentialStatus={credentialStatus}
            isLastMethod={isLastMethod}
            isManaged={(id) => isManaged(`portalConfig.oauth.${id}`)}
            saving={saving || isPending}
            onToggle={handleToggle}
            onConfigure={openConfigDialog}
            excludeProviderIds={['custom-oidc']}
          />
        </div>
      </div>

      {/* Card — Custom OIDC (own surface; not in the social grid) */}
      <CustomOidcCard
        configured={!!credentialStatus['custom-oidc']}
        enabled={!!oauthState['custom-oidc']}
        managed={isManaged('portalConfig.oauth.custom-oidc')}
        lastMethod={isLastMethod('custom-oidc')}
        tierEnabled={customOidcProviderTier}
        saving={saving || isPending}
        onToggle={(v) => handleToggle('custom-oidc', v)}
        onConfigure={() => {
          // Look up by provider id (not credentialType — that's what
          // `getAuthProvider(...)` takes). Inline lookup avoids the wrong
          // helper.
          const provider = AUTH_PROVIDERS.find((p) => p.id === 'custom-oidc')
          if (provider) openConfigDialog(provider)
        }}
      />

      {(saving || isPending) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving…</span>
        </div>
      )}

      {configDialog && (
        <AuthProviderCredentialsDialog
          credentialType={configDialog.credentialType}
          providerId={configDialog.providerId}
          providerName={configDialog.providerName}
          helpUrl={configDialog.helpUrl}
          fields={configDialog.fields}
          open={!!configDialog}
          onOpenChange={(open) => !open && setConfigDialog(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PortalInvitesSection
// ---------------------------------------------------------------------------

type PortalInvite = {
  id: string
  email: string
  status: string | null
  kind: string | null
  createdAt: string
  lastSentAt: string | null
  expiresAt: string
}

function formatInviteDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

const PORTAL_INVITES_QUERY_KEY = ['portal', 'invites'] as const

function InviteStatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          Pending
        </Badge>
      )
    case 'accepted':
      return (
        <Badge
          variant="outline"
          className="border-green-500/30 text-green-600 text-[10px] px-1.5 py-0"
        >
          Accepted
        </Badge>
      )
    case 'canceled':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          Revoked
        </Badge>
      )
    case 'expired':
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Expired
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {status ?? 'Unknown'}
        </Badge>
      )
  }
}

interface InviteRowProps {
  invite: PortalInvite
  onRevoke: (id: string) => Promise<void>
  onResend: (id: string) => Promise<void>
  revoking: boolean
  resending: boolean
}

function InviteRow({ invite, onRevoke, onResend, revoking, resending }: InviteRowProps) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const sentDate = invite.lastSentAt ?? invite.createdAt

  const handleRevokeClick = () => {
    if (!confirmRevoke) {
      setConfirmRevoke(true)
      return
    }
    setConfirmRevoke(false)
    void onRevoke(invite.id)
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invite.email}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Sent {formatInviteDate(sentDate)}</p>
      </div>
      <InviteStatusBadge status={invite.status} />
      {invite.status === 'pending' && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onResend(invite.id)}
            disabled={resending || revoking}
            className="h-7 px-2 text-xs"
          >
            {resending ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> : 'Resend'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRevokeClick}
            disabled={resending || revoking}
            className={cn(
              'h-7 px-2 text-xs',
              confirmRevoke
                ? 'border border-destructive/40 text-destructive hover:bg-destructive/10'
                : 'text-muted-foreground hover:text-destructive'
            )}
          >
            {revoking ? (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            ) : confirmRevoke ? (
              'Confirm revoke'
            ) : (
              'Revoke'
            )}
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * Email-invite sub-section rendered inside the Portal Visibility card.
 *
 * Intentionally uses its own busy state(s) — invite mutations write to the
 * `invitation` table, completely separate from the portal-config/access
 * saves guarded by `accessBusy` in the parent. The two concerns do not
 * race and should not share a lock.
 */
function PortalInvitesSection() {
  const queryClient = useQueryClient()

  const { data: invites, isLoading: invitesLoading } = useQuery<PortalInvite[]>({
    queryKey: PORTAL_INVITES_QUERY_KEY,
    queryFn: () => fetchPortalInvitesFn(),
    staleTime: 30 * 1000,
  })

  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [sendBusy, setSendBusy] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [resendConfirm, setResendConfirm] = useState<string | null>(null)

  const refetch = () => queryClient.invalidateQueries({ queryKey: PORTAL_INVITES_QUERY_KEY })

  const handleSend = async () => {
    const email = emailInput.trim()
    if (!email) return

    if (!isValidEmail(email)) {
      setEmailError('Enter a valid email address.')
      return
    }
    setEmailError(null)
    setActionError(null)
    setSendBusy(true)
    try {
      await sendPortalInviteFn({ data: { email } })
      setEmailInput('')
      void refetch()
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send invite.')
    } finally {
      setSendBusy(false)
    }
  }

  const handleResend = async (id: string) => {
    setActionError(null)
    setResendingId(id)
    setResendConfirm(null)
    try {
      await resendPortalInviteFn({ data: { inviteId: id } })
      setResendConfirm(id)
      void refetch()
      // Clear the brief confirmation after 3 s
      setTimeout(() => setResendConfirm((prev) => (prev === id ? null : prev)), 3000)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resend invite.')
    } finally {
      setResendingId(null)
    }
  }

  const handleRevoke = async (id: string) => {
    setActionError(null)
    setRevokingId(id)
    try {
      await cancelPortalInviteFn({ data: { inviteId: id } })
      void refetch()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke invite.')
    } finally {
      setRevokingId(null)
    }
  }

  const handleEmailKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSend()
    }
  }

  const anyBusy = sendBusy || resendingId !== null || revokingId !== null

  return (
    <div className="mt-6 border-t border-border/50 pt-6 space-y-4">
      <div>
        <p className="text-sm font-medium">Email invites</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Invite specific people by email. They&apos;ll get a magic link to sign in and access the
          portal.
        </p>
      </div>

      {/* Send form */}
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            type="email"
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value)
              if (emailError) setEmailError(null)
            }}
            onKeyDown={handleEmailKeyDown}
            placeholder="user@example.com"
            disabled={anyBusy}
            aria-label="Email address to invite"
            aria-invalid={!!emailError}
            className={cn(emailError && 'border-destructive')}
          />
          {emailError && <p className="mt-1 text-xs text-destructive">{emailError}</p>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleSend()}
          disabled={!emailInput.trim() || anyBusy}
          className="h-9 shrink-0"
        >
          {sendBusy ? (
            <ArrowPathIcon className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
          )}
          Send invite
        </Button>
      </div>

      {/* Action-level error (resend/revoke) */}
      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      {/* Invite list */}
      {invitesLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
          <span>Loading invites…</span>
        </div>
      ) : invites && invites.length > 0 ? (
        <>
          {resendConfirm && <p className="text-xs text-muted-foreground">Invite resent.</p>}
          <ul className="space-y-1.5" role="list" aria-label="Portal invites">
            {invites.map((inv) => (
              <InviteRow
                key={inv.id}
                invite={inv}
                onRevoke={handleRevoke}
                onResend={handleResend}
                revoking={revokingId === inv.id}
                resending={resendingId === inv.id}
              />
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">No invites sent yet.</p>
      )}
    </div>
  )
}

interface CustomOidcCardProps {
  configured: boolean
  enabled: boolean
  managed: boolean
  lastMethod: boolean
  tierEnabled: boolean
  saving: boolean
  onToggle: (next: boolean) => void
  onConfigure: () => void
}

/**
 * Dedicated card for custom OIDC. Separated from the alphabetical social
 * grid because bring-your-own-IdP is a different shape of setup than a
 * social tile — there's a discovery URL, a client secret, and tier gating
 * to surface. Splitting Social vs Enterprise SSO into distinct sections
 * follows the same convention used across most auth-focused admin UIs.
 *
 * Three states drive the layout, in priority order:
 *  - `!tierEnabled`: tier-locked. Lock badge + upgrade hint; Configure is
 *    disabled, no toggle (nothing to toggle into).
 *  - `!configured`: no credentials yet. Primary "Set up" CTA, no toggle.
 *  - `configured`: outlined Edit button + the enable switch, mirroring
 *    the "configured" half of the social grid tiles.
 */
function CustomOidcCard({
  configured,
  enabled,
  managed,
  lastMethod,
  tierEnabled,
  saving,
  onToggle,
  onConfigure,
}: CustomOidcCardProps) {
  const headerBadge = (() => {
    if (!tierEnabled) {
      return (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          <LockClosedIcon className="mr-1 h-2.5 w-2.5" />
          Higher tier
        </Badge>
      )
    }
    if (!configured) return null
    if (enabled) {
      return (
        <Badge
          variant="outline"
          className="border-green-500/30 text-green-600 text-[10px] px-1.5 py-0"
        >
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
          Active
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        Configured
      </Badge>
    )
  })()

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <div className="flex items-start gap-4 p-6">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            tierEnabled ? 'bg-violet-600/10' : 'bg-muted'
          )}
        >
          <ShieldCheckIcon
            className={cn('h-5 w-5', tierEnabled ? 'text-violet-600' : 'text-muted-foreground/60')}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Custom identity provider</h2>
            {headerBadge}
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Let portal users sign in via your own IdP. Works with any OpenID Connect provider —
            Okta, Azure AD, Auth0, Keycloak, and more.
          </p>

          {!tierEnabled ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Available on plans with the custom OIDC feature.
            </p>
          ) : !configured ? (
            <div className="mt-4">
              <Button
                type="button"
                size="sm"
                onClick={onConfigure}
                disabled={managed}
                className="h-9"
              >
                Set up custom OIDC
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onConfigure}
                disabled={managed}
                className="h-9"
              >
                Edit configuration
              </Button>
              {managed && (
                <span className="text-xs text-muted-foreground">
                  Managed by your configuration file.
                </span>
              )}
            </div>
          )}
        </div>
        {tierEnabled && configured && (
          <div className="shrink-0">
            <Switch
              id="custom-oidc-toggle"
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={saving || managed || lastMethod}
              aria-label="Enable custom OIDC for the portal"
            />
          </div>
        )}
      </div>
    </div>
  )
}
