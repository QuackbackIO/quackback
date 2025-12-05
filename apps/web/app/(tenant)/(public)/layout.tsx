import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { PoweredByFooter } from '@/components/public/powered-by-footer'
import { theme } from '@quackback/shared'

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

  // Generate theme CSS from org config
  const themeConfig = theme.parseThemeConfig(org.themeConfig)
  const themeStyles = themeConfig ? theme.generateThemeCSS(themeConfig) : ''

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={org.logo}
        userRole={userRole}
        userName={session?.user.name}
        userEmail={session?.user.email}
        userImage={session?.user.image}
      />
      <main className="mx-auto max-w-5xl w-full flex-1">{children}</main>
      <PoweredByFooter />
    </div>
  )
}
