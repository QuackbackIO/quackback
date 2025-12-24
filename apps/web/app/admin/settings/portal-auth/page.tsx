import { requireTenantRole } from '@/lib/tenant'
import { workspaceService, DEFAULT_PORTAL_CONFIG } from '@quackback/domain'
import { Lock } from 'lucide-react'
import { PortalAuthSettings } from './portal-auth-settings'

export default async function PortalAuthPage({ params: _params }: { params?: Promise<object> }) {
  // Settings is validated in root layout
  // Only owners and admins can access portal auth settings
  await requireTenantRole(['owner', 'admin'])

  // Fetch portal config
  const configResult = await workspaceService.getPortalConfig()
  const portalConfig = configResult.success ? configResult.value : DEFAULT_PORTAL_CONFIG

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
        <PortalAuthSettings initialConfig={{ oauth: portalConfig.oauth }} />
      </div>
    </div>
  )
}
