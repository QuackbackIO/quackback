import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [org, userRole, session] = await Promise.all([
    getCurrentOrganization(),
    getCurrentUserRole(),
    getSession(),
  ])

  // Org validation is done in parent tenant layout
  if (!org) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <PortalHeader
        orgName={org.name}
        orgLogo={org.logo}
        userRole={userRole}
        userName={session?.user.name}
        userEmail={session?.user.email}
        userImage={session?.user.image}
      />
      <main>{children}</main>
    </div>
  )
}
