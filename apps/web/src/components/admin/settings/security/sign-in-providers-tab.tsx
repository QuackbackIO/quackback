import { useState, useTransition } from 'react'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowPathIcon, EnvelopeIcon, KeyIcon, ShieldCheckIcon } from '@heroicons/react/24/solid'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { OAuthProviderGrid } from '@/components/admin/settings/auth-shared/oauth-provider-grid'
import { AuthProviderCredentialsDialog } from '@/components/admin/settings/portal-auth/auth-provider-credentials-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { WarningBox } from '@/components/shared/warning-box'
import { IdentityProvidersSection } from '@/components/admin/settings/security/identity-providers/provider-list'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { updateAuthConfigFn, updatePortalConfigFn } from '@/lib/server/functions/settings'
import type { AuthConfig, PortalAuthMethods, PortalConfig } from '@/lib/shared/types/settings'

interface SignInProvidersTabProps {
  /** Team-side auth config from settings.authConfig. */
  initialTeamAuthConfig: AuthConfig
  /** Portal-side oauth/methods from settings.portalConfig.oauth. */
  initialPortalOauth: PortalAuthMethods
  portalConfig: PortalConfig
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
 * Migration nuance:
 *  - For `password` and `magicLink` the data model still has separate
 *    flags on `auth.oauth.*` (team) and `portalConfig.oauth.*` (portal).
 *    The UI shows ONE toggle that reads as OR(team, portal) and writes
 *    to BOTH — never *removes* a working sign-in path on save, only
 *    promotes the more-permissive value into the unified slot.
 *  - For social providers and Custom OIDC the schema only has the
 *    portal flag today, so the unified toggle just maps onto it.
 *    Enabling Google here implicitly enables it for the team sign-in
 *    surface too, which is a new capability that previously required
 *    SSO setup.
 */
export function SignInProvidersTab({
  initialTeamAuthConfig,
  initialPortalOauth,
  portalConfig: _portalConfig,
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
  // Built-in methods (password, magic link): seed from OR of team + portal
  // so existing asymmetric tenants land on the more-permissive value.
  const [teamAuthConfig, setTeamAuthConfig] = useState<AuthConfig>(initialTeamAuthConfig)
  const teamOauth = (teamAuthConfig.oauth ?? {}) as Record<string, boolean | undefined>

  const [oauthState, setOauthState] = useState<Record<string, boolean | undefined>>(() => ({
    ...initialPortalOauth,
    // For built-ins, OR the two surfaces — show "on" if either side
    // would actually accept a sign-in. Per-surface defaults mirror the
    // runtime gates in `auth-restrictions.ts` so the seed never
    // disagrees with what the server is accepting:
    //   - Team password / magic-link: `!== false`  (default ON)
    //   - Portal password:            `?? true`    (default ON)
    //   - Portal magic-link:          `?? false`   (default OFF)
    // Treating `undefined` on the team side as enabled (the prior
    // `!== false` check) was correct; treating `undefined` on the
    // portal side as disabled (the prior `=== true` check) was NOT
    // — it produced "off" seeds on tenants whose portal password is
    // running on the implicit default. Subsequent writes fan to both.
    password: teamOauth.password !== false || (initialPortalOauth.password ?? true),
    magicLink: teamOauth.magicLink !== false || (initialPortalOauth.magicLink ?? false),
  }))

  const emailConfigured = credentialStatus._emailConfigured !== false
  const passwordEnabled = !!oauthState.password
  const magicLinkEnabled = !!oauthState.magicLink
  const twoFactorRequired = teamAuthConfig.twoFactor?.required === true

  /** "Last method standing" guard — refuses to disable the only enabled
   *  provider so visitors and team admins aren't locked out. Counts only
   *  what would *actually accept a sign-in today*:
   *   - password — always counts when enabled
   *   - magicLink — only when email delivery is configured (otherwise
   *     the toggle is on but the runtime path rejects)
   *   - social/OIDC — only when credentials are configured (the row
   *     renders as "Not configured" otherwise and isn't usable)
   *  Legacy `email` flag excluded (migration 0049 retired it). */
  const enabledMethodCount = Object.entries(oauthState).reduce((acc, [id, enabled]) => {
    if (!enabled) return acc
    if (id === 'email') return acc
    if (id === 'password') return acc + 1
    if (id === 'magicLink') return emailConfigured ? acc + 1 : acc
    return credentialStatus[id] ? acc + 1 : acc
  }, 0)
  const isLastMethod = (id: string) => {
    if (!oauthState[id]) return false
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

  // ---------- Save fan-out ----------
  /**
   * Toggling password / magic link writes to BOTH the team auth config
   * and the portal oauth config. We do them SEQUENTIALLY (team first,
   * then portal) so that on failure of the second call we can attempt
   * to roll back the first one — leaving the two surfaces consistent
   * is the entire reason the unified toggle exists. A best-effort
   * rollback isn't perfect (the rollback itself can fail), but it's
   * strictly better than the Promise.all behavior which silently kept
   * the surviving server-side change.
   */
  const saveBuiltin = async (key: 'password' | 'magicLink', value: boolean) => {
    setSaving(true)
    const prevTeam = teamAuthConfig
    const prevOauth = oauthState
    const prevValue = prevOauth[key]
    setOauthState((p) => ({ ...p, [key]: value }))
    setTeamAuthConfig((p) => ({ ...p, oauth: { ...(p.oauth ?? {}), [key]: value } }))
    try {
      const updated = await updateAuthConfigFn({ data: { oauth: { [key]: value } } })
      try {
        await updatePortalConfigFn({ data: { oauth: { [key]: value } } })
      } catch (portalErr) {
        // Portal write failed — team write already committed. Try to
        // roll team back to the prior value so the server stays
        // consistent; if rollback itself fails the surfaces drift,
        // and we surface a more specific error so the admin knows.
        try {
          // `!!` coerces undefined to false. Strictly, undefined meant
          // "rely on the runtime default"; writing false is slightly
          // more restrictive but is the safer rollback choice on a
          // path that exists only after a save failure.
          await updateAuthConfigFn({ data: { oauth: { [key]: !!prevValue } } })
        } catch {
          toast.error(
            'Saved on the team side but the portal save failed; rollback also failed — please reload and verify.'
          )
          throw portalErr
        }
        throw portalErr
      }
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
   * Toggling a social / OIDC provider writes to BOTH the team auth
   * config and the portal oauth config under the unified model —
   * `auth-restrictions.ts:96` gates the team surface on
   * `authConfig?.oauth?.[provider] === true`, so a portal-only write
   * would leave the provider broken for team admin sign-in despite
   * the UI claiming it's enabled. Same sequential + rollback shape
   * as `saveBuiltin`.
   */
  const saveOauthProvider = async (providerId: string, checked: boolean) => {
    setSaving(true)
    const prevTeam = teamAuthConfig
    const prevValue = oauthState[providerId]
    // Use an updater so concurrent toggles on other providers don't
    // get clobbered by a stale closure capture.
    setOauthState((p) => ({ ...p, [providerId]: checked }))
    setTeamAuthConfig((p) => ({ ...p, oauth: { ...(p.oauth ?? {}), [providerId]: checked } }))
    try {
      const updated = await updateAuthConfigFn({ data: { oauth: { [providerId]: checked } } })
      try {
        await updatePortalConfigFn({ data: { oauth: { [providerId]: checked } } })
      } catch (portalErr) {
        try {
          await updateAuthConfigFn({ data: { oauth: { [providerId]: !!prevValue } } })
        } catch {
          toast.error(
            'Saved on the team side but the portal save failed; rollback also failed — please reload and verify.'
          )
          throw portalErr
        }
        throw portalErr
      }
      setTeamAuthConfig(updated)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      startTransition(() => router.invalidate())
    } catch (err) {
      // Updater form so the revert doesn't clobber unrelated provider
      // toggles that landed between the optimistic update and now.
      setOauthState((p) => ({ ...p, [providerId]: prevValue }))
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
          description={
            <>
              Visitors and team admins can&apos;t sign in. Enable at least one provider below — or
              set up SSO on the{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">/sso</code> page for the
              team.
            </>
          }
        />
      )}

      {/* Card 1: Built-in (password + magic link) — applies to both
          surfaces. Single toggle per row; saveBuiltin fans out to both
          auth.oauth.X and portalConfig.oauth.X. */}
      <SettingsCard
        title="Email"
        description="Built-in sign-in for the portal and the admin team."
        contentClassName="space-y-4"
      >
        <MethodRow
          icon={KeyIcon}
          label="Password"
          description={
            passwordEnabled && twoFactorRequired
              ? 'Sign in with email and password. Required while 2FA enforcement is on — TOTP enrollment requires a password.'
              : 'Sign in with email and password.'
          }
          checked={passwordEnabled}
          onCheckedChange={(v) => void saveBuiltin('password', v)}
          disabled={
            busy ||
            isManaged('auth.oauth.password') ||
            isManaged('portalConfig.oauth.password') ||
            isLastMethod('password') ||
            // 2FA enforcement (Team access tab) requires password as the
            // factor that 2FA enrolls *on top of*. Disabling password
            // while 2FA is required would lock all team members out;
            // mirror the guard the old Team-tab Sign-in card carried.
            (passwordEnabled && twoFactorRequired)
          }
          badge={
            isManaged('auth.oauth.password') || isManaged('portalConfig.oauth.password')
              ? 'Managed'
              : undefined
          }
        />
        {/* Nested: 2FA enforcement lives here because TOTP enrols on
            top of a password. Indented to signal it is a child setting
            of the Password row above, not a peer method. */}
        <div className="ml-[52px] space-y-4 border-l border-border pl-4">
          <MethodRow
            icon={ShieldCheckIcon}
            label="Require 2FA for team members"
            description={
              passwordEnabled
                ? 'Members must pass a TOTP challenge to sign in. Recovery codes are the break-glass.'
                : 'Enable Password sign-in first — enrolling 2FA requires a password.'
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

      {/* Card 2: Social sign-in — single set of toggles for both
          surfaces. Configure credentials once; the toggle decides
          whether it shows up on portal AND admin sign-in screens. */}
      <SettingsCard
        title="Social sign-in"
        description="Let visitors and team admins sign in with Google, GitHub, and more."
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

      {/* Card 3: Identity providers (OIDC). One row per provider in the
          identity_provider table; editing a row opens the per-provider
          editor (connection + verified domains + visibility + role
          provisioning). Supersedes the former single Custom OIDC card. */}
      <IdentityProvidersSection tierEnabled={customOidcProviderTier} />

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
