import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import { PortalAuthSettings } from '@/components/admin/settings/portal-auth/portal-auth-settings'
import { SettingsCard } from '@/components/admin/settings/settings-card'

export const Route = createFileRoute('/admin/settings/portal-auth')({
  loader: async ({ context }) => {
    // Settings is validated in root layout
    // Only owners and admins can access portal auth settings (more restrictive than parent)
    const { requireWorkspaceRole } = await import('@/lib/server/functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['admin'] } })

    const { queryClient } = context

    await queryClient.ensureQueryData(settingsQueries.portalConfig())

    return {}
  },
  component: PortalAuthPage,
})

function PortalAuthPage() {
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <LockClosedIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Portal Authentication</h1>
          <p className="text-sm text-muted-foreground">
            Configure how visitors can sign in to your public feedback portal
          </p>
        </div>
      </div>

      {/* Authentication Methods */}
      <SettingsCard
        title="Sign-in Methods"
        description="Choose which authentication methods are available to portal users"
      >
        <PortalAuthSettings initialConfig={{ oauth: portalConfigQuery.data.oauth }} />
      </SettingsCard>
    </div>
  )
}
