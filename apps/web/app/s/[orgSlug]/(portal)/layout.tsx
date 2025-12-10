import { getOrganizationBySlug, getCurrentUserRoleBySlug } from '@/lib/tenant'
import { getSession } from '@/lib/auth/server'
import { PortalHeader } from '@/components/public/portal-header'
import { PoweredByFooter } from '@/components/public/powered-by-footer'
import { getUserAvatarData } from '@/lib/avatar'
import { getOrganizationLogoData } from '@/lib/organization'
import { AuthPopoverProvider } from '@/components/auth/auth-popover-context'
import { AuthDialog } from '@/components/auth/auth-dialog'
import { SessionProvider } from '@/components/providers/session-provider'
import { theme } from '@quackback/domain'

// Force dynamic rendering since we read session cookies
export const dynamic = 'force-dynamic'

/**
 * Public portal layout - no auth required
 * Provides org branding and navigation
 */
export default async function PublicLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params

  const [org, userRole, session] = await Promise.all([
    getOrganizationBySlug(orgSlug),
    getCurrentUserRoleBySlug(orgSlug),
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

  // Build auth config for the auth dialog
  const authConfig = {
    found: true,
    portalAuthEnabled: org.portalAuthEnabled,
    googleEnabled: org.portalGoogleEnabled,
    githubEnabled: org.portalGithubEnabled,
    microsoftEnabled: false, // Not supported for portal users
  }

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
      {/* Auth dialog for inline authentication */}
      <AuthDialog authConfig={authConfig} />
    </div>
  )

  // Wrap with providers:
  // - SessionProvider hydrates better-auth session from SSR data (prevents flash)
  // - AuthPopoverProvider manages auth dialog state
  return (
    <SessionProvider initialSession={session}>
      <AuthPopoverProvider>{content}</AuthPopoverProvider>
    </SessionProvider>
  )
}
