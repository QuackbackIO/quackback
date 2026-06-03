import { useState, useTransition } from 'react'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { MethodRow } from '@/components/admin/settings/auth-shared/method-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { updateAuthConfigFn } from '@/lib/server/functions/settings'
import { isPathManagedFromBootstrap } from '@/lib/client/config-file'
import type { AuthConfig } from '@/lib/shared/types/settings'

interface TeamAuthMethodsSectionProps {
  initialConfig: AuthConfig
}

/**
 * Team access policy card — rendered on the "Team access" tab.
 *
 * Previously this section also owned the team's Sign-in methods card
 * (password + magic-link toggles). Those have moved to the "Sign-in
 * providers" tab where they sit beside the portal toggles in a single
 * dual-toggle row per method. This file now owns only the team-side
 * policy controls (require 2FA, etc.) plus the SSO summary callout
 * mounted next to it from the AuthSettings parent.
 */
export function TeamAuthMethodsSection({ initialConfig }: TeamAuthMethodsSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()
  const [authConfig, setAuthConfig] = useState<AuthConfig>(initialConfig)

  const { managedFieldPaths = [] } =
    (useRouteContext({ from: '__root__' }) as { managedFieldPaths?: string[] }) ?? {}
  const isManaged = (path: string) => isPathManagedFromBootstrap(path, managedFieldPaths)

  const passwordEnabled = (authConfig.oauth ?? {}).password !== false
  const twoFactorRequired = authConfig.twoFactor?.required === true

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

  const toggleTwoFactorRequired = (checked: boolean) => {
    setAuthConfig((prev: AuthConfig) => ({
      ...prev,
      twoFactor: { ...(prev.twoFactor ?? { required: false }), required: checked },
    }))
    void save({ twoFactor: { required: checked } })
  }

  return (
    <SettingsCard
      title="Team security policy"
      description="Requirements that apply on top of the sign-in methods on the Sign-in providers tab."
      contentClassName="space-y-4"
    >
      <MethodRow
        icon={ShieldCheckIcon}
        label="Require 2FA for team members"
        description={
          passwordEnabled
            ? 'Members must pass a TOTP challenge to sign in. Recovery codes are the break-glass.'
            : 'Enable Password sign-in first (on the Sign-in providers tab) — enrolling 2FA requires a password.'
        }
        checked={twoFactorRequired}
        onCheckedChange={toggleTwoFactorRequired}
        disabled={saving || isPending || isManaged('auth.twoFactor.required') || !passwordEnabled}
        badge={isManaged('auth.twoFactor.required') ? 'Managed' : undefined}
      />
    </SettingsCard>
  )
}
