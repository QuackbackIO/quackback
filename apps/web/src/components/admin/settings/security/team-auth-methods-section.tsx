import { useState, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { EnvelopeIcon, KeyIcon, ShieldCheckIcon } from '@heroicons/react/24/solid'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import { useRouteContext } from '@tanstack/react-router'
import type { AuthConfig } from '@/lib/shared/types/settings'

interface TeamAuthMethodsSectionProps {
  initialConfig: AuthConfig
}

export function TeamAuthMethodsSection({ initialConfig }: TeamAuthMethodsSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const [authConfig, setAuthConfig] = useState<AuthConfig>(initialConfig)

  const { managedFieldPaths = [] } =
    (useRouteContext({ from: '__root__' }) as { managedFieldPaths?: string[] }) ?? {}
  const isManaged = (path: string) => isPathManagedFromBootstrap(path, managedFieldPaths)

  const oauthState = (authConfig.oauth ?? {}) as Record<string, boolean | undefined>
  const passwordEnabled = oauthState.password !== false
  const magicLinkEnabled = oauthState.magicLink !== false

  // SSO is not relevant here — these are the non-SSO team methods. The
  // "last method" guard only considers password + magic-link (SSO as a
  // fallback is handled separately on the /sso page).
  const enabledMethodCount = (passwordEnabled ? 1 : 0) + (magicLinkEnabled ? 1 : 0)
  const isLastTeamMethod = (current: boolean) => current && enabledMethodCount === 1

  const save = async (input: Parameters<typeof updateAuthConfigFn>[0]['data']) => {
    setSaving(true)
    try {
      const updated = await updateAuthConfigFn({ data: input })
      setAuthConfig(updated)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'authConfig'] })
      startTransition(() => {
        router.invalidate()
      })
      toast.success('Authentication settings saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const togglePassword = (checked: boolean) => {
    setAuthConfig((prev: AuthConfig) => ({
      ...prev,
      oauth: { ...(prev.oauth ?? {}), password: checked },
    }))
    void save({ oauth: { password: checked } })
  }

  const toggleMagicLink = (checked: boolean) => {
    setAuthConfig((prev: AuthConfig) => ({
      ...prev,
      oauth: { ...(prev.oauth ?? {}), magicLink: checked },
    }))
    void save({ oauth: { magicLink: checked } })
  }

  const twoFactorRequired = authConfig.twoFactor?.required === true
  const toggleTwoFactorRequired = (checked: boolean) => {
    setAuthConfig((prev: AuthConfig) => ({
      ...prev,
      twoFactor: { ...(prev.twoFactor ?? { required: false }), required: checked },
    }))
    void save({ twoFactor: { required: checked } })
  }

  return (
    <SettingsCard
      title="Sign-in methods"
      description="Email magic link is always on for invitations and recovery. Single sign-on is managed below."
      contentClassName="space-y-4"
    >
      <MethodRow
        icon={KeyIcon}
        label="Password"
        description="Sign in with email and password."
        checked={passwordEnabled}
        onCheckedChange={togglePassword}
        disabled={
          saving ||
          isPending ||
          isManaged('auth.oauth.password') ||
          isLastTeamMethod(passwordEnabled) ||
          (passwordEnabled && twoFactorRequired)
        }
        badge={isManaged('auth.oauth.password') ? 'Managed' : undefined}
      />
      <MethodRow
        icon={EnvelopeIcon}
        label="Magic link"
        description="Sign in with a one-click link emailed to the user. Invitations and recovery-code flows always work — this toggle only controls whether the option appears on the team sign-in form."
        checked={magicLinkEnabled}
        onCheckedChange={toggleMagicLink}
        disabled={
          saving ||
          isPending ||
          isManaged('auth.oauth.magicLink') ||
          isLastTeamMethod(magicLinkEnabled)
        }
        badge={isManaged('auth.oauth.magicLink') ? 'Managed' : undefined}
      />
      <MethodRow
        icon={ShieldCheckIcon}
        label="Require 2FA for team members"
        description={
          passwordEnabled
            ? 'Admins and members must complete a TOTP challenge on every password sign-in, and magic-link sign-in is refused for users who have enrolled. Recovery codes remain available as the break-glass.'
            : 'Enable Password sign-in first — enrolling a TOTP authenticator requires confirming a password.'
        }
        checked={twoFactorRequired}
        onCheckedChange={toggleTwoFactorRequired}
        disabled={saving || isPending || isManaged('auth.twoFactor.required') || !passwordEnabled}
        badge={isManaged('auth.twoFactor.required') ? 'Managed' : undefined}
      />
      <MethodRow
        icon={EnvelopeIcon}
        label="Email me when a new device signs in"
        description="When someone signs in from a browser or network we haven't seen before, we'll send the account owner an email. First-line defense against credential compromise."
        checked={authConfig.security?.notifyOnNewSignIn !== false}
        onCheckedChange={(checked) => {
          setAuthConfig((prev: AuthConfig) => ({
            ...prev,
            security: { ...(prev.security ?? {}), notifyOnNewSignIn: checked },
          }))
          void save({ security: { notifyOnNewSignIn: checked } })
        }}
        disabled={saving || isPending || isManaged('auth.security.notifyOnNewSignIn')}
        badge={isManaged('auth.security.notifyOnNewSignIn') ? 'Managed' : undefined}
      />
    </SettingsCard>
  )
}
