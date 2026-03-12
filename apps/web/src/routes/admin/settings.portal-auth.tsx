import { useState, useTransition } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { adminQueries } from '@/lib/client/queries/admin'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
import { PortalAuthSettings } from '@/components/admin/settings/portal-auth/portal-auth-settings'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { updatePortalConfigFn } from '@/lib/server/functions/settings'

export const Route = createFileRoute('/admin/settings/portal-auth')({
  loader: async ({ context }) => {
    // Settings is validated in root layout
    // Only owners and admins can access portal auth settings (more restrictive than parent)
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context

    await Promise.all([
      queryClient.ensureQueryData(settingsQueries.portalConfig()),
      queryClient.ensureQueryData(adminQueries.authProviderStatus()),
    ])

    return {}
  },
  component: PortalAuthPage,
})

function PortalAuthPage() {
  const router = useRouter()
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())
  const credentialStatusQuery = useSuspenseQuery(adminQueries.authProviderStatus())
  const [isPending, startTransition] = useTransition()
  const [anonVoting, setAnonVoting] = useState(
    portalConfigQuery.data.features?.anonymousVoting ?? true
  )

  async function handleAnonVotingToggle(checked: boolean) {
    setAnonVoting(checked)
    await updatePortalConfigFn({ data: { features: { anonymousVoting: checked } } })
    startTransition(() => {
      router.invalidate()
    })
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={LockClosedIcon}
        title="Portal Authentication"
        description="Configure how visitors can sign in to your public feedback portal"
      />

      {/* Anonymous Voting */}
      <SettingsCard
        title="Anonymous Voting"
        description="Allow visitors to vote on posts without signing in. Anonymous users are rate-limited to prevent abuse."
      >
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="anon-voting-toggle" className="font-medium cursor-pointer">
              Enable anonymous voting
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Visitors can vote without creating an account. Votes are tracked per browser session.
            </p>
          </div>
          <Switch
            id="anon-voting-toggle"
            checked={anonVoting}
            onCheckedChange={handleAnonVotingToggle}
            disabled={isPending}
            aria-label="Anonymous voting"
          />
        </div>
      </SettingsCard>

      {/* Authentication Methods */}
      <SettingsCard
        title="Sign-in Methods"
        description="Choose which authentication methods are available to portal users. Configure OAuth providers by adding your app credentials."
      >
        <PortalAuthSettings
          initialConfig={{ oauth: portalConfigQuery.data.oauth }}
          credentialStatus={credentialStatusQuery.data}
        />
      </SettingsCard>
    </div>
  )
}
