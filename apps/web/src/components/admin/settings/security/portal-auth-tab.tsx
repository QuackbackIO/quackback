import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ArrowPathIcon, EnvelopeIcon, KeyIcon } from '@heroicons/react/24/solid'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { OAuthProviderGrid } from '@/components/admin/settings/auth-shared/oauth-provider-grid'
import { AuthProviderCredentialsDialog } from '@/components/admin/settings/portal-auth/auth-provider-credentials-dialog'
import { AUTH_PROVIDERS } from '@/lib/shared/auth-providers'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { useRouteContext } from '@tanstack/react-router'
import type { PortalAuthMethods } from '@/lib/shared/types'

interface PortalAuthTabProps {
  initialOauth: PortalAuthMethods
  credentialStatus: Record<string, boolean> & { _emailConfigured?: boolean }
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
 *  - No standalone Custom OIDC card. Bring-your-own-IdP is configured
 *    once under /admin/settings/security/sso and surfaces as a single
 *    "Continue with $idp" button on both Team and Portal sign-in
 *    pages — there is no longer a separate `auth_custom-oidc`
 *    credentials path. See `apps/web/src/lib/server/auth/auth-providers.ts`
 *    for the deprecation note.
 *  - Magic Link defaults to off; password defaults to on.
 *  - No enforcement / bootstrap guard — portal is opt-in self-service.
 */
export function PortalAuthTab({ initialOauth, credentialStatus }: PortalAuthTabProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const [oauthState, setOauthState] = useState<Record<string, boolean | undefined>>(initialOauth)

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
    <div className="space-y-8">
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
          />
        </div>
      </div>

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
