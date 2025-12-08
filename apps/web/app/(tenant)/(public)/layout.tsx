import { getCurrentOrganization, getCurrentUserRole } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { PoweredByFooter } from '@/components/public/powered-by-footer'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationLogoData } from '@/lib/organization'
import { UserProfileProvider } from '@/components/providers/user-profile-provider'
import { theme } from '@quackback/domain'

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

  // Get avatar URL with base64 data for SSR (no flicker)
  // Get logo URL from blob storage for SSR
  const [avatarData, logoData] = await Promise.all([
    session?.user ? getUserAvatarData(session.user.id, session.user.image) : null,
    getOrganizationLogoData(org.id),
  ])

  // Generate theme CSS from org config
  const themeConfig = theme.parseThemeConfig(org.themeConfig)
  const themeStyles = themeConfig ? theme.generateThemeCSS(themeConfig) : ''

  // Build initial user data for SSR (used by both header props and provider)
  const initialUserData = session?.user
    ? {
        name: session.user.name,
        email: session.user.email,
        avatarUrl: avatarData?.avatarUrl ?? null,
      }
    : undefined

  const content = (
    <div className="min-h-screen bg-background flex flex-col">
      {themeStyles && <style dangerouslySetInnerHTML={{ __html: themeStyles }} />}
      <PortalHeader
        orgName={org.name}
        orgLogo={logoData.logoUrl}
        userRole={userRole}
        initialUserData={initialUserData}
      />
      <main className="mx-auto max-w-5xl w-full flex-1">{children}</main>
      <PoweredByFooter />
    </div>
  )

  // Only wrap with provider if user is logged in
  if (session?.user && initialUserData) {
    return (
      <UserProfileProvider
        initialData={{
          ...initialUserData,
          hasCustomAvatar: avatarData?.hasCustomAvatar ?? false,
        }}
      >
        {content}
      </UserProfileProvider>
    )
  }

  return content
}
