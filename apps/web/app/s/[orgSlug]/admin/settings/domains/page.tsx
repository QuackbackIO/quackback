import { requireTenantRoleBySlug } from '@/lib/tenant'
import { Globe } from 'lucide-react'
import { DomainList } from './domain-list'

export default async function DomainsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  // Only owners and admins can access domain settings
  const { organization } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Globe className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Custom Domains</h1>
          <p className="text-sm text-muted-foreground">
            Configure custom domains for your feedback portal
          </p>
        </div>
      </div>

      {/* Domain List */}
      <DomainList organizationId={organization.id} orgSlug={organization.slug} />
    </div>
  )
}
