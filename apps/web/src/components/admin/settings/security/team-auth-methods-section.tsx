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
    <>
      <SettingsCard
        title="Sign-in methods"
        description="How your team signs in to the admin dashboard."
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
          label="Email magic link"
          description="One-click link or 6-digit code by email."
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
      </SettingsCard>

      <SettingsCard
        title="Team security policy"
        description="Requirements applied on top of the sign-in methods above."
        contentClassName="space-y-4"
      >
        <MethodRow
          icon={ShieldCheckIcon}
          label="Require 2FA for team members"
          description={
            passwordEnabled
              ? 'Members must pass a TOTP challenge to sign in. Recovery codes are the break-glass.'
              : 'Enable Password sign-in first — enrolling 2FA requires a password.'
          }
          checked={twoFactorRequired}
          onCheckedChange={toggleTwoFactorRequired}
          disabled={saving || isPending || isManaged('auth.twoFactor.required') || !passwordEnabled}
          badge={isManaged('auth.twoFactor.required') ? 'Managed' : undefined}
        />
      </SettingsCard>
    </>
  )
}
