import { requireTenantRoleBySlug } from '@/lib/tenant'
import { Shield } from 'lucide-react'
import { SsoProviderList } from './sso-provider-list'

export default async function SecurityPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  // Only owners and admins can access security settings
  const { organization } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Authentication</h1>
          <p className="text-sm text-muted-foreground">
            Manage authentication methods for {organization.name}
          </p>
        </div>
      </div>

      {/* Enterprise SSO */}
      <SsoProviderList organizationId={organization.id} />
    </div>
  )
}
