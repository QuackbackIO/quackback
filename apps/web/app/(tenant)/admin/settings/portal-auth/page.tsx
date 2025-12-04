import { requireTenantRole } from '@/lib/tenant'
import { Lock } from 'lucide-react'
import { PortalAuthToggles } from './portal-auth-toggles'
import { PortalRequireAuthToggle } from './portal-require-auth-toggle'
import { PortalInteractionToggles } from './portal-interaction-toggles'

// Check which OAuth providers are globally configured
const googleAvailable = !!process.env.GOOGLE_CLIENT_ID
const githubAvailable = !!process.env.GITHUB_CLIENT_ID

export default async function PortalAuthPage() {
  // Only owners and admins can access portal auth settings
  const { organization } = await requireTenantRole(['owner', 'admin'])

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

      {/* Portal User Accounts */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Portal User Accounts</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Allow visitors to create accounts and sign in on your public portal. Authenticated users
          can vote and comment with their identity instead of anonymously.
        </p>
        <PortalAuthToggles
          organizationId={organization.id}
          portalAuthEnabled={organization.portalAuthEnabled}
          portalPasswordEnabled={organization.portalPasswordEnabled}
          portalGoogleEnabled={organization.portalGoogleEnabled}
          portalGithubEnabled={organization.portalGithubEnabled}
          googleAvailable={googleAvailable}
          githubAvailable={githubAvailable}
        />
      </div>

      {/* Interaction Settings */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Public Interactions</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Control what visitors can do without signing in
        </p>
        <PortalInteractionToggles
          organizationId={organization.id}
          portalPublicVoting={organization.portalPublicVoting}
          portalPublicCommenting={organization.portalPublicCommenting}
        />
      </div>

      {/* Access Control */}
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <h2 className="font-medium mb-1">Access Control</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Control anonymous access to your portal
        </p>
        <PortalRequireAuthToggle
          organizationId={organization.id}
          initialValue={organization.portalRequireAuth}
        />
      </div>
    </div>
  )
}
