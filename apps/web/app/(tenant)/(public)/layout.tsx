import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { PortalHeader } from '@/components/public/portal-header'

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [org, userRole] = await Promise.all([getCurrentOrganization(), getCurrentUserRole()])

  // Org validation is done in parent tenant layout
  if (!org) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader orgName={org.name} orgLogo={org.logo} userRole={userRole} />
      <main>{children}</main>
    </div>
  )
}
