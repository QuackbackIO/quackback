import { useState, useTransition } from 'react'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowPathIcon, EnvelopeIcon, KeyIcon, ShieldCheckIcon } from '@heroicons/react/24/solid'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { OAuthProviderGrid } from '@/components/admin/settings/auth-shared/oauth-provider-grid'
import { AuthProviderCredentialsDialog } from '@/components/admin/settings/portal-auth/auth-provider-credentials-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WarningBox } from '@/components/shared/warning-box'
import { IdentityProvidersSection } from '@/components/admin/settings/security/identity-providers/provider-list'
import { countEnabledAuthMethods } from '@/components/admin/settings/security/auth-method-count'
import { settingsQueries } from '@/lib/client/queries/settings'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { isSignInMethodEnabled } from '@/lib/shared/signin-methods'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import type { AuthConfig } from '@/lib/shared/types/settings'

interface SignInProvidersTabProps {
  /** Team-side auth config from settings.authConfig. */
  initialTeamAuthConfig: AuthConfig
  credentialStatus: Record<string, boolean> & { _emailConfigured?: boolean }
  customOidcProviderTier: boolean
}

/**
 * Sign-in providers tab — the third top-level tab on /authentication.
 *
 * One toggle per provider. SSO enforcement on /sso is the team-side
 * lockdown; any enabled provider here is a valid entry path for both
 * the portal and the admin team sign-in (subject to the access rules
 * on the Portal access tab + SSO enforcement on the Team access tab).
 *
 * All toggles write to `authConfig.oauth` — a single unified config that
 * governs sign-in for both the portal and the admin team surface.
 * `isSignInMethodEnabled` applies the correct defaults at display time:
 * password is ON unless explicitly disabled; magic-link and social providers
 * are opt-in (OFF unless explicitly true).
 */
export function SignInProvidersTab({
  initialTeamAuthConfig,
  credentialStatus,
  customOidcProviderTier,
}: SignInProvidersTabProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  const { managedFieldPaths = [] } =
    (useRouteContext({ from: '__root__' }) as { managedFieldPaths?: string[] }) ?? {}
  const isManaged = (path: string) => isPathManagedFromBootstrap(path, managedFieldPaths)

  // ---------- Unified state ----------
  // Seed from authConfig.oauth only. isSignInMethodEnabled applies the correct
  // display defaults at render time: password is ON when the key is absent,
  // magic-link and social providers are OFF unless explicitly true.
  const [teamAuthConfig, setTeamAuthConfig] = useState<AuthConfig>(initialTeamAuthConfig)

  const [oauthState, setOauthState] = useState<Record<string, boolean | undefined>>(
    () => (teamAuthConfig.oauth ?? {}) as Record<string, boolean | undefined>
  )

  // Identity providers share the cache IdentityProvidersSection reads
  // (preloaded by the route loader). Counting enabled+configured ones here lets
  // the built-in / social toggles treat a working IdP as a valid fallback.
  const identityProviders = useSuspenseQuery(settingsQueries.identityProviders()).data ?? []

  const emailConfigured = credentialStatus._emailConfigured !== false
  const passwordEnabled = isSignInMethodEnabled(oauthState, 'password')
  const magicLinkEnabled = isSignInMethodEnabled(oauthState, 'magicLink')
  const twoFactorRequired = teamAuthConfig.twoFactor?.required === true

  /** "Last method standing" guard — refuses to disable the only working
   *  sign-in method so visitors and team admins aren't locked out. The count
   *  spans all three surfaces (built-in, social, and the identity_provider
   *  table); `countEnabledAuthMethods` defines exactly what counts as usable. */
  const enabledMethodCount = countEnabledAuthMethods({
    oauthState,
    emailConfigured,
    credentialStatus,
    // IdPs only register (and so only count as a method) when the tier is on.
    identityProviders: customOidcProviderTier ? identityProviders : [],
  })
  const isLastMethod = (id: string) => {
    if (!isSignInMethodEnabled(oauthState, id)) return false
    // Mirror the same usability filter the count uses — an enabled-but-
    // unusable row (magic link with no email config, social with no
    // credentials) shouldn't be treated as the "last working method"
    // because it isn't actually working.
    if (id === 'magicLink' && !emailConfigured) return false
    if (id !== 'password' && id !== 'magicLink' && id !== 'email' && !credentialStatus[id]) {
      return false
    }
    return enabledMethodCount === 1
  }

  /** Gate on what's actually *usable*: a `google: true` flag with no
   *  saved credential is shown as "Not configured" and doesn't count.
   *  When everything is off (or off + unusable), surface the warning
   *  banner — admins would otherwise have a portal that no one can
   *  sign into. */
  const noAuthEnabled = enabledMethodCount === 0

  // ---------- Save ----------
  /**
   * Toggling password / magic link writes to authConfig.oauth — the single
   * unified config for both portal and team sign-in. Disabling password while
   * 2FA enforcement is on cascades 2FA off in the same save so team members
   * aren't locked out (TOTP enrolls on top of a password).
   */
  const saveBuiltin = async (key: 'password' | 'magicLink', value: boolean) => {
    setSaving(true)
    const prevTeam = teamAuthConfig
    const prevOauth = oauthState
    // Disabling password while 2FA enforcement is on would lock team members
    // out (TOTP enrols on top of a password), so cascade 2FA off in the same
    // atomic save instead of blocking the toggle.
    const cascadeDisable2FA = key === 'password' && !value && twoFactorRequired
    setOauthState((p) => ({ ...p, [key]: value }))
    setTeamAuthConfig((p) => ({
      ...p,
      oauth: { ...(p.oauth ?? {}), [key]: value },
      ...(cascadeDisable2FA && { twoFactor: { ...(p.twoFactor ?? {}), required: false } }),
    }))
    try {
      const updated = await updateAuthConfigFn({
        data: {
          oauth: { [key]: value },
          ...(cascadeDisable2FA && { twoFactor: { required: false } }),
        },
      })
      setTeamAuthConfig(updated)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      startTransition(() => router.invalidate())
    } catch (err) {
      // Revert local state to match what the server (now) reflects.
      setOauthState(prevOauth)
      setTeamAuthConfig(prevTeam)
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Toggling a social provider writes to authConfig.oauth — the single
   * unified config that gates the provider on both the portal and team
   * sign-in surfaces.
   */
  const saveOauthProvider = async (providerId: string, checked: boolean) => {
    setSaving(true)
    const prevTeam = teamAuthConfig
    const prevOauth = oauthState
    // Use an updater so concurrent toggles on other providers don't
    // get clobbered by a stale closure capture.
    setOauthState((p) => ({ ...p, [providerId]: checked }))
    setTeamAuthConfig((p) => ({ ...p, oauth: { ...(p.oauth ?? {}), [providerId]: checked } }))
    try {
      const updated = await updateAuthConfigFn({ data: { oauth: { [providerId]: checked } } })
      setTeamAuthConfig(updated)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      startTransition(() => router.invalidate())
    } catch (err) {
      // Updater form so the revert doesn't clobber unrelated provider
      // toggles that landed between the optimistic update and now.
      setOauthState((p) => ({ ...p, [providerId]: prevOauth[providerId] }))
      setTeamAuthConfig(prevTeam)
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- 2FA requirement (child of Password) ----------
  /**
   * Require-2FA is a team-side policy that builds on top of password
   * sign-in. Only writes to auth config (no portal side), and is
   * disabled when password is off (TOTP enrollment requires a password).
   */
  const saveTwoFactor = async (checked: boolean) => {
    setSaving(true)
    try {
      const updated = await updateAuthConfigFn({ data: { twoFactor: { required: checked } } })
      setTeamAuthConfig(updated)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      startTransition(() => router.invalidate())
      toast.success('Authentication settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  // ---------- Credentials dialog (shared across all providers) ----------
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

  const busy = saving || isPending

  return (
    <div className="space-y-6">
      {noAuthEnabled && (
        <WarningBox
          variant="warning"
          title="No sign-in method enabled"
          description="Visitors and team admins can't sign in. Enable at least one provider or configure an identity provider below."
        />
      )}

      {/* Card 1: Built-in (password + magic link). Single toggle per row;
          writes to authConfig.oauth for both portal and team sign-in. */}
      <SettingsCard
        title="Email"
        description="Built-in sign-in for users."
        contentClassName="space-y-4"
      >
        <MethodRow
          icon={KeyIcon}
          label="Password"
          description="Sign in with email and password."
          checked={passwordEnabled}
          onCheckedChange={(v) => void saveBuiltin('password', v)}
          disabled={
            busy ||
            isManaged('auth.oauth.password') ||
            isManaged('portalConfig.oauth.password') ||
            isLastMethod('password')
          }
          badge={
            isManaged('auth.oauth.password') || isManaged('portalConfig.oauth.password')
              ? 'Managed'
              : undefined
          }
        />
        {/* Nested under Password: 2FA enforcement builds on top of the password
            (TOTP enrols over it). The left rule + indent mark it as a child
            setting of the Password row, not a peer. */}
        <div className="ml-5 space-y-4 border-l-2 border-border/60 pl-5">
          <MethodRow
            compact
            muted={!passwordEnabled}
            icon={ShieldCheckIcon}
            label="Require two-factor authentication"
            description={
              passwordEnabled
                ? 'Users must enter a code from their authenticator app after their password.'
                : 'Turn on Password sign-in to require a second factor.'
            }
            checked={twoFactorRequired}
            onCheckedChange={(v) => void saveTwoFactor(v)}
            disabled={busy || isManaged('auth.twoFactor.required') || !passwordEnabled}
            badge={isManaged('auth.twoFactor.required') ? 'Managed' : undefined}
          />
        </div>
        <MethodRow
          icon={EnvelopeIcon}
          label="Email magic link"
          description={
            emailConfigured
              ? 'One-click link or 6-digit code by email.'
              : 'Configure SMTP or Resend to enable email delivery.'
          }
          checked={magicLinkEnabled}
          onCheckedChange={(v) => void saveBuiltin('magicLink', v)}
          disabled={
            busy ||
            !emailConfigured ||
            isManaged('auth.oauth.magicLink') ||
            isManaged('portalConfig.oauth.magicLink') ||
            isLastMethod('magicLink')
          }
          badge={
            isManaged('auth.oauth.magicLink') || isManaged('portalConfig.oauth.magicLink')
              ? 'Managed'
              : undefined
          }
        />
      </SettingsCard>

      {/* Card 2: Social sign-in. Configure credentials once; the toggle
          enables the provider on both portal and admin sign-in screens. */}
      <SettingsCard
        title="Social sign-in"
        description="Let users sign in with Google, GitHub, and more."
      >
        <OAuthProviderGrid
          enabled={oauthState}
          credentialStatus={credentialStatus}
          isLastMethod={isLastMethod}
          isManaged={(id) => isManaged(`portalConfig.oauth.${id}`)}
          saving={busy}
          onToggle={(id, checked) => void saveOauthProvider(id, checked)}
          onConfigure={openConfigDialog}
          excludeProviderIds={['custom-oidc']}
        />
      </SettingsCard>

      {/* Card 3: Single sign-on (OIDC). One row per provider in the
          identity_provider table; editing a row opens the per-provider
          editor (connection + verified domains + visibility + role
          provisioning). Recovery codes — the break-glass for SSO — are
          nested inside this card. */}
      <IdentityProvidersSection
        tierEnabled={customOidcProviderTier}
        enabledMethodCount={enabledMethodCount}
      />

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowPathIcon className="h-4 w-4 animate-spin" />
          <span>Saving…</span>
        </div>
      )}

      {configDialog && (
        <AuthProviderCredentialsDialog
          open={!!configDialog}
          onOpenChange={(open) => {
            if (!open) setConfigDialog(null)
          }}
          credentialType={configDialog.credentialType}
          providerId={configDialog.providerId}
          providerName={configDialog.providerName}
          helpUrl={configDialog.helpUrl}
          fields={configDialog.fields}
        />
      )}
    </div>
  )
}
