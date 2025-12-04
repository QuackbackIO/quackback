import { requireTenantRole } from '@/lib/tenant'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PortalAuthToggles } from './portal-auth-toggles'
import { PortalRequireAuthToggle } from './portal-require-auth-toggle'

// Check which OAuth providers are globally configured
const googleAvailable = !!process.env.GOOGLE_CLIENT_ID
const githubAvailable = !!process.env.GITHUB_CLIENT_ID

export default async function PortalAuthPage() {
  // Only owners and admins can access portal auth settings
  const { organization } = await requireTenantRole(['owner', 'admin'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Portal Authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how visitors can sign in to your public feedback portal
        </p>
      </div>

      {/* Portal User Accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Portal User Accounts</CardTitle>
          <CardDescription>
            Allow visitors to create accounts and sign in on your public portal. Authenticated users
            can vote and comment with their identity instead of anonymously.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PortalAuthToggles
            organizationId={organization.id}
            portalAuthEnabled={organization.portalAuthEnabled}
            portalPasswordEnabled={organization.portalPasswordEnabled}
            portalGoogleEnabled={organization.portalGoogleEnabled}
            portalGithubEnabled={organization.portalGithubEnabled}
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
          />
        </CardContent>
      </Card>

      {/* Access Control */}
      <Card>
        <CardHeader>
          <CardTitle>Access Control</CardTitle>
          <CardDescription>Control anonymous access to your portal</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalRequireAuthToggle
            organizationId={organization.id}
            initialValue={organization.portalRequireAuth}
          />
        </CardContent>
      </Card>
    </div>
  )
}
