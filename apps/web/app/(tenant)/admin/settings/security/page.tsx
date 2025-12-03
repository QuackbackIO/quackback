import { requireTenantRole } from '@/lib/tenant'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StrictSsoToggle } from './strict-sso-toggle'
import { SsoProviderList } from './sso-provider-list'
import { PasswordAuthToggle } from './password-auth-toggle'
import { OAuthProviderToggles } from './oauth-provider-toggles'

// Check which OAuth providers are globally configured
const googleAvailable = !!process.env.GOOGLE_CLIENT_ID
const githubAvailable = !!process.env.GITHUB_CLIENT_ID
const microsoftAvailable = !!process.env.MICROSOFT_CLIENT_ID

export default async function SecurityPage() {
  // Only owners and admins can access security settings
  const { organization } = await requireTenantRole(['owner', 'admin'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Authentication</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage authentication methods for {organization.name}
        </p>
      </div>

      {/* Password Authentication */}
      <Card>
        <CardHeader>
          <CardTitle>Password Authentication</CardTitle>
          <CardDescription>Allow users to sign in with email and password</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordAuthToggle
            organizationId={organization.id}
            initialValue={organization.passwordAuthEnabled}
          />
        </CardContent>
      </Card>

      {/* Social Login */}
      <Card>
        <CardHeader>
          <CardTitle>Social Login</CardTitle>
          <CardDescription>Allow users to sign in with external accounts</CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthProviderToggles
            organizationId={organization.id}
            googleEnabled={organization.googleOAuthEnabled}
            githubEnabled={organization.githubOAuthEnabled}
            microsoftEnabled={organization.microsoftOAuthEnabled}
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            microsoftAvailable={microsoftAvailable}
          />
        </CardContent>
      </Card>

      {/* Enterprise SSO */}
      <SsoProviderList organizationId={organization.id} />

      {/* Advanced: SSO Identity Isolation */}
      <Card>
        <CardHeader>
          <CardTitle>Advanced: SSO Identity Isolation</CardTitle>
          <CardDescription>Control how SSO users are linked to existing accounts</CardDescription>
        </CardHeader>
        <CardContent>
          <StrictSsoToggle
            organizationId={organization.id}
            initialValue={organization.strictSsoMode}
          />
        </CardContent>
      </Card>
    </div>
  )
}
