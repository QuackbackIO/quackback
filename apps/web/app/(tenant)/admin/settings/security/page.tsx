import { requireTenantRole } from '@/lib/tenant'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StrictSsoToggle } from './strict-sso-toggle'

export default async function SecurityPage() {
  // Only owners and admins can access security settings
  const { organization } = await requireTenantRole(['owner', 'admin'])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage security settings for {organization.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>SSO Identity Isolation</CardTitle>
          <CardDescription>Control how SSO users are linked to existing accounts</CardDescription>
        </CardHeader>
        <CardContent>
          <StrictSsoToggle
            organizationId={organization.id}
            initialValue={organization.strictSsoMode}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SSO Providers</CardTitle>
          <CardDescription>Configure SAML and OIDC providers for your organization</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            SSO provider configuration coming soon. Contact support to set up enterprise SSO.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
