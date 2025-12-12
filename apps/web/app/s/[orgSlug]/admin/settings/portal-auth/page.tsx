import { requireTenantRoleBySlug } from '@/lib/tenant'
import { Lock, Mail } from 'lucide-react'

export default async function PortalAuthPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  // Only owners and admins can access portal auth settings
  const { organization } = await requireTenantRoleBySlug(orgSlug, ['owner', 'admin'])

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
          Users sign in to {organization.name}&apos;s portal using magic email codes.
        </p>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Mail className="h-4 w-4" />
          <span>Email authentication is enabled for all portal users</span>
        </div>
      </div>
    </div>
  )
}
