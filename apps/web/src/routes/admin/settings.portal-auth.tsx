import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { settingsQueries } from '@/lib/queries/settings'
import { Lock } from 'lucide-react'
import { PortalAuthSettings } from '@/components/admin/settings/portal-auth/portal-auth-settings'

export const Route = createFileRoute('/admin/settings/portal-auth')({
  loader: async ({ context }) => {
    // Settings is validated in root layout
    // Only owners and admins can access portal auth settings (more restrictive than parent)
    const { requireWorkspaceRole } = await import('@/lib/server-functions/workspace-utils')
    await requireWorkspaceRole({ data: { allowedRoles: ['owner', 'admin'] } })

    const { queryClient } = context

    // Pre-fetch portal config using React Query
    await queryClient.ensureQueryData(settingsQueries.portalConfig())

    return {}
  },
  component: PortalAuthPage,
})

function PortalAuthPage() {
  // Read pre-fetched data from React Query cache
  const portalConfigQuery = useSuspenseQuery(settingsQueries.portalConfig())

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Lock className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Portal Authentication</h1>
          <p className="text-sm text-muted-foreground">
            Configure how visitors can sign in to your public feedback portal
          </p>
        </div>
      </div>

      {/* Authentication Methods - Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Left column - heading and description */}
        <div className="space-y-1">
          <h2 className="font-semibold">Sign-in Methods</h2>
          <p className="text-sm text-muted-foreground">
            Choose which authentication methods are available to portal users
          </p>
        </div>

        {/* Right column - settings card */}
        <PortalAuthSettings initialConfig={{ oauth: portalConfigQuery.data.oauth }} />
      </div>
    </div>
  )
}
