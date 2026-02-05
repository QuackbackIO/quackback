import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/client/queries/settings'
import { LockClosedIcon } from '@heroicons/react/24/solid'
import { BackLink } from '@/components/ui/back-link'
import { PageHeader } from '@/components/shared/page-header'
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
    <div className="space-y-6 max-w-5xl">
      <div className="lg:hidden">
        <BackLink to="/admin/settings">Settings</BackLink>
      </div>
      <PageHeader
        icon={LockClosedIcon}
        title="Portal Authentication"
        description="Configure how visitors can sign in to your public feedback portal"
      />

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
